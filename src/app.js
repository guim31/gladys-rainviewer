// -----------------------------------------------------------------------------
// The integration, wired to a Gladys client (the real one in index.js, the
// SDK's fake in the tests).
//
// Every CYCLE_MS the container asks RainViewer for its newest radar frame (a
// new one comes every 10 minutes). On a new frame, every place added in Gladys
// is read (rain over it, nearest rain), its picture is drawn and pushed to its
// camera, its states are published, and the scene triggers are evaluated.
// The devices are published with should_poll: false: Gladys' scheduler polls
// once a minute at most, and the radar needs no more than its own pace.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { MAX_PLACES, normalizeConfig, parsePlaces } from './config.js';
import { buildDevice, buildStates, deviceIds, placeId } from './devices.js';
import { analyzePlace, CAMERA_PREFIX, renderPlace, WATCH_RADIUS_KM } from './radar.js';
import { createSources } from './sources.js';
import { CHECK_TEXT, CONNECTION_TEXT, FAILURE, ActionFailure, timeOf } from './texts.js';
import { SCENE_ACTIONS } from './scenes.js';
import { WIDGET_KEY, WIDGETS, widgetImage } from './widgets.js';

export const CYCLE_MS = 5 * 60_000;
// A stable value is re-sent this often, so Gladys never shows it as stale.
export const HEARTBEAT_MS = 6 * 3600_000;
// RainViewer unreachable this long: the integration says so in Gladys.
export const OUTAGE_MS = 30 * 60_000;
// A reading older than this is not the weather of now (frames lag ~10 min).
export const STALE_MS = 45 * 60_000;
// Dry radar frames (10 minutes each) after which the rain has stopped.
export const DRY_FRAMES_TO_STOP = 2;
export const TRIGGERS = { APPROACHING: 'rain_approaching', STOPPED: 'rain_stopped' };
const LANGS = ['en', 'fr', 'de', 'es'];

/**
 * @param {object} gladys - GladysIntegration (or the SDK's fake).
 * @param {object} [options] - Test seams.
 * @param {Function} [options.fetch] - fetch.
 * @param {Function} [options.now] - Clock, ms.
 * @param {string|null} [options.cacheDir] - Map tile cache (default /data/basemap).
 * @param {boolean} [options.timers] - Run the periodic cycle (false in tests).
 * @param {object} [options.logger] - Logger.
 * @returns {object} The app.
 */
export function createApp(gladys, options = {}) {
  const logger = options.logger ?? createLogger({ name: 'rainviewer' });
  const now = options.now ?? Date.now;
  const sources = createSources({
    fetch: options.fetch,
    now,
    cacheDir: options.cacheDir === undefined ? '/data/basemap' : options.cacheDir,
    logger,
  });

  let config = normalizeConfig();
  let places = [];
  let invalidPlaces = [];
  let frame = null;
  let lastSuccess = null;
  const startedAt = now();
  const failingPlaces = new Set();
  let failing = false;
  let reportedDown = false;
  let timer = null;
  let running = null;
  // placeId -> { reading, framePath, image, imageFrame, imageZoom, rainSince, lastRainAt, dry, near }
  const watched = new Map();

  // Throttled by the core (one call per 10 s): a refused nudge is harmless.
  const refreshWidget = () =>
    Promise.resolve()
      .then(() => gladys.requestWidgetRefresh(WIDGET_KEY))
      .catch((err) => logger.debug(`Widget refresh refused: ${err.message}`));

  const createdIds = () => new Set((gladys.devices ?? []).map((device) => device.external_id));
  const isCreated = (place, created = createdIds()) => created.has(deviceIds(gladys, place).device);

  async function loadPlaces() {
    let houses = null;
    try {
      houses = await gladys.getHouses();
    } catch (err) {
      logger.debug(`Houses unreadable: ${err.message}`);
    }
    const located = Array.isArray(houses)
      ? houses
          .filter((house) => Number.isFinite(house?.latitude) && Number.isFinite(house?.longitude))
          .map((house) => ({
            houseId: house.id,
            name: String(house.name ?? '').trim() || 'Home',
            latitude: house.latitude,
            longitude: house.longitude,
          }))
      : places.filter((place) => place.houseId);
    const parsed = parsePlaces(config.extra_places);
    if (parsed.errors.length > 0 && parsed.errors.join() !== invalidPlaces.join()) {
      logger.warn(`Other places not understood: ${parsed.errors.join(' ; ')}`);
    }
    invalidPlaces = parsed.errors;
    const all = [...located, ...parsed.places];
    const unique = all.filter(
      (place, index) => all.findIndex((other) => placeId(other) === placeId(place)) === index,
    );
    if (unique.length > MAX_PLACES && places.length <= MAX_PLACES) {
      logger.warn(`${unique.length} places: only the first ${MAX_PLACES} are watched`);
    }
    places = unique.slice(0, MAX_PLACES);
    return places;
  }

  async function publishDevices() {
    await gladys.publishDiscoveredDevices(
      places.map((place) => buildDevice(gladys, place, config.language)),
    );
  }

  async function fetchFrame() {
    try {
      frame = await sources.latestFrame();
      lastSuccess = now();
      if (failing) {
        failing = false;
        logger.info('RainViewer answers again');
      }
      if (reportedDown) {
        reportedDown = false;
        await gladys.setConnectionStatus(true).catch(() => {});
      }
      return frame;
    } catch (err) {
      if (!failing) {
        failing = true;
        logger.warn(`RainViewer unreachable: ${err.message}`);
      } else {
        logger.debug(`RainViewer still unreachable: ${err.message}`);
      }
      if (!reportedDown && now() - (lastSuccess ?? startedAt) >= OUTAGE_MS) {
        reportedDown = true;
        await gladys.setConnectionStatus(false, CONNECTION_TEXT.unreachable).catch(() => {});
      }
      throw err;
    }
  }

  /** Forget the trigger state: the next reading sets it without any event. */
  function resetTriggers(entry) {
    entry.near = undefined;
    entry.rainSince = null;
    entry.lastRainAt = null;
    entry.dry = 0;
  }

  /** The scene events of a new frame, from the previous state of the place. */
  function fireTriggers(place, entry, reading, current) {
    const events = [];
    if (!reading.covered) {
      // Unknown there: start afresh when the radar sees the place again.
      resetTriggers(entry);
      return events;
    }
    const near =
      reading.raining || (reading.distanceKm !== null && reading.distanceKm <= config.approach_km);
    if (entry.near === undefined) {
      // First reading (start-up, device added, back in coverage, new
      // distance): the state only, never a transition.
      entry.near = near;
      entry.rainSince = reading.raining ? current.time : null;
      entry.lastRainAt = entry.rainSince;
      entry.dry = 0;
      return events;
    }
    const base = { place: deviceIds(gladys, place).device, place_name: place.name };
    if (near && entry.near === false) {
      // Rain crossing the distance, or a shower that started within one frame.
      events.push([
        TRIGGERS.APPROACHING,
        { ...base, distance_km: reading.raining ? 0 : reading.distanceKm },
      ]);
    }
    entry.near = near;
    if (reading.raining) {
      entry.rainSince ??= current.time;
      entry.lastRainAt = current.time;
      entry.dry = 0;
    } else if (entry.rainSince !== null) {
      entry.dry += 1;
      if (entry.dry >= DRY_FRAMES_TO_STOP) {
        const minutes = Math.round((entry.lastRainAt - entry.rainSince) / 60_000) + 10;
        events.push([TRIGGERS.STOPPED, { ...base, duration_minutes: minutes }]);
        entry.rainSince = null;
        entry.lastRainAt = null;
      }
    }
    return events;
  }

  /** Read, draw and publish one place for a frame. */
  async function processPlace(place, current, { force = false } = {}) {
    const id = placeId(place);
    if (!watched.has(id)) {
      watched.set(id, { near: undefined, dry: 0, rainSince: null, lastRainAt: null });
    }
    const entry = watched.get(id);
    let events = [];
    if (entry.framePath !== current.path || force) {
      const reading = await analyzePlace(sources, current, place, { logger });
      if (entry.framePath !== current.path) {
        events = fireTriggers(place, entry, reading, current);
      }
      if (entry.covered !== undefined && entry.covered !== reading.covered) {
        logger.info(`${place.name}: ${reading.covered ? 'back in' : 'outside'} the radar coverage`);
      } else if (entry.covered === undefined && !reading.covered) {
        logger.info(`${place.name}: outside the radar coverage, rain unknown there`);
      }
      entry.covered = reading.covered;
      entry.reading = reading;
      entry.framePath = current.path;
      entry.frameTime = current.time;
    }
    // The events first: a refused state must not lose them.
    for (const [key, data] of events) {
      logger.debug(`${place.name}: ${key}`);
      await gladys
        .publishSceneEvent(key, data)
        .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
    }
    if (entry.imageFrame !== current.path || entry.imageZoom !== config.zoom || force) {
      entry.image = await renderPlace(sources, current, place, {
        zoom: Number(config.zoom),
        // 24-hour clock: the bitmap font has no AM/PM.
        time: timeOf(current.time, 'fr'),
        logger,
      });
      entry.imageFrame = current.path;
      entry.imageZoom = config.zoom;
      entry.imageTime = current.time;
      await gladys
        .publishCameraImage(
          deviceIds(gladys, place).device,
          `${CAMERA_PREFIX}${entry.image.toString('base64')}`,
        )
        .catch((err) => logger.debug(`Camera image of ${place.name} refused: ${err.message}`));
    }
    await gladys
      .publishChangedStates(
        buildStates(gladys, place, entry.reading, timeOf(entry.frameTime, config.language)),
        { heartbeat: HEARTBEAT_MS },
      )
      // Not remembered by the SDK: sent again at the next cycle.
      .catch((err) => logger.debug(`States of ${place.name} refused: ${err.message}`));
    return entry;
  }

  /** One refresh: frame, then every place added in Gladys. */
  async function cycle({ force = false } = {}) {
    await loadPlaces();
    const current = await fetchFrame();
    const created = createdIds();
    let changed = false;
    for (const place of places.filter((item) => isCreated(item, created))) {
      const id = placeId(place);
      const before = watched.get(id)?.imageFrame;
      try {
        const entry = await processPlace(place, current, { force });
        changed ||= entry.imageFrame !== before;
        if (failingPlaces.delete(id)) {
          logger.info(`${place.name}: radar read again`);
        }
      } catch (err) {
        // One line at the first failure, one at the recovery.
        if (failingPlaces.has(id)) {
          logger.debug(`${place.name}: radar still not read (${err.message})`);
        } else {
          failingPlaces.add(id);
          logger.warn(`${place.name}: radar not read (${err.message})`);
        }
      }
    }
    if (changed || force) {
      refreshWidget();
    }
  }

  /** Run a cycle, or join the one running. */
  function refresh(opts) {
    if (!running) {
      running = cycle(opts)
        .catch((err) => logger.debug(`Cycle failed: ${err.message}`))
        .finally(() => {
          running = null;
        });
    }
    return running;
  }

  /** A cycle that starts after the one running (new config, new device). */
  async function refreshAfter(opts) {
    if (running) {
      await running;
    }
    return refresh(opts);
  }

  function placeOf(externalId) {
    return places.find((place) => deviceIds(gladys, place).device === externalId) ?? null;
  }

  /** The reading of a place chosen in a scene or a widget (read now if needed). */
  async function readingOf(externalId) {
    if (!externalId) {
      throw new ActionFailure(FAILURE.pick);
    }
    let place = placeOf(externalId);
    if (!place) {
      await loadPlaces();
      place = placeOf(externalId);
    }
    if (!place) {
      throw new ActionFailure(FAILURE.unknownPlace);
    }
    const fresh = (item) => item?.reading && now() - item.frameTime < STALE_MS;
    let entry = watched.get(placeId(place));
    if (!fresh(entry)) {
      try {
        await refreshAfter();
        entry = watched.get(placeId(place));
        if (!fresh(entry) && frame && now() - frame.time < STALE_MS) {
          // Not added in Gladys (no cycle reads it): read it for this answer.
          entry = await processPlace(place, frame);
        }
      } catch {
        throw new ActionFailure(FAILURE.unreachable);
      }
    }
    if (!fresh(entry)) {
      // RainViewer down: an old reading would pass for the weather of now.
      throw new ActionFailure(FAILURE.unreachable);
    }
    return { place, entry };
  }

  async function check() {
    await loadPlaces();
    if (places.length === 0) {
      throw new ActionFailure(FAILURE.noPlace);
    }
    await refreshAfter();
    if (failing || !frame) {
      throw new ActionFailure(FAILURE.unreachable);
    }
    const message = {};
    for (const lang of LANGS) {
      const text = CHECK_TEXT[lang];
      const lines = [text.head(timeOf(frame.time, lang))];
      for (const place of places) {
        const entry = watched.get(placeId(place));
        const reading = entry?.reading;
        let status = text.pending;
        if (reading && !reading.covered) {
          status = text.outside;
        } else if (reading?.raining) {
          status = text.raining(reading.rate);
        } else if (reading && reading.distanceKm !== null) {
          status = text.near(reading.distanceKm);
        } else if (reading) {
          status = text.dry(WATCH_RADIUS_KM);
        }
        lines.push(`- ${place.name}: ${status}`);
      }
      if (invalidPlaces.length > 0) {
        lines.push(text.invalid(invalidPlaces.join(' ; ')));
      }
      message[lang] = lines.join('\n');
    }
    return message;
  }

  const app = {
    get config() {
      return config;
    },
    get places() {
      return places;
    },
    get frame() {
      return frame;
    },
    watched,
    refresh,
    readingOf,
    deviceName: (place) =>
      (gladys.devices ?? []).find(
        (device) => device.external_id === deviceIds(gladys, place).device,
      )?.name ?? place.name,
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
  };

  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await loadPlaces();
      await publishDevices();
      if (places.length === 0) {
        logger.warn('No place to watch: no house of Gladys has a location, and no other place');
      }
    } catch (err) {
      logger.error('Initialization failed', err);
    }
    await refresh();
    if (options.timers !== false && !timer) {
      timer = setInterval(() => refresh(), CYCLE_MS);
      timer.unref?.();
    }
  });

  gladys.onScanRequest(async () => {
    await loadPlaces();
    await publishDevices();
  });

  gladys.onConfigUpdated(async (raw) => {
    const previous = config;
    config = normalizeConfig(raw);
    if (config.approach_km !== previous.approach_km) {
      // A new distance is no rain approaching: re-read the state quietly.
      for (const entry of watched.values()) {
        entry.near = undefined;
      }
    }
    await loadPlaces();
    await publishDevices();
    await refreshAfter();
  });

  // Added in Gladys: read it now and send everything (states sent before the
  // device existed were dropped by Gladys).
  gladys.onDeviceCreated(async (device) => {
    const place = placeOf(device?.external_id);
    if (place) {
      // The SDK forgets the published states of a created device by itself.
      // Drawn earlier (the device was deleted, then added again): the cycle
      // will not draw it again for this frame, so its image is sent here.
      const drawnBefore = watched.get(placeId(place))?.image !== undefined;
      await refreshAfter();
      const entry = watched.get(placeId(place));
      if (drawnBefore && entry?.image) {
        await gladys
          .publishCameraImage(
            device.external_id,
            `${CAMERA_PREFIX}${entry.image.toString('base64')}`,
          )
          .catch(() => {});
      }
      refreshWidget();
    }
  });
  gladys.onDeviceUpdated?.(() => refreshWidget());
  gladys.onDeviceDeleted?.(() => refreshWidget());

  gladys.onGetImage(async (device) => {
    const { entry } = await readingOf(device?.external_id);
    if (!entry.image) {
      throw new ActionFailure(FAILURE.unreachable);
    }
    return `${CAMERA_PREFIX}${entry.image.toString('base64')}`;
  });

  // Published with should_poll: false; only answers a Gladys that polls anyway.
  gladys.onPoll(async () => {});

  gladys.onAction('check', async () => {
    logger.info('Action check');
    return check();
  });

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(app, { fields }));
  }
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(app, request));
  }
  gladys.onWidgetGetImage((key) => widgetImage(app, key));

  return app;
}
