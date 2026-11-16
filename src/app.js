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
      if (!reportedDown && (lastSuccess === null || now() - lastSuccess >= OUTAGE_MS)) {
        reportedDown = true;
        await gladys.setConnectionStatus(false, CONNECTION_TEXT.unreachable).catch(() => {});
      }
      throw err;
    }
  }

  function fireTriggers(place, entry, reading) {
    const events = [];
    const ids = deviceIds(gladys, place);
    const base = { place: ids.device, place_name: place.name };
    if (!reading.covered) {
      return events;
    }
    if (reading.raining) {
      entry.rainSince ??= frame.time;
      entry.lastRainAt = frame.time;
      entry.dry = 0;
      entry.near = true;
    } else {
      if (entry.rainSince !== undefined && entry.rainSince !== null) {
        entry.dry += 1;
        if (entry.dry >= DRY_FRAMES_TO_STOP) {
          const minutes = Math.round((entry.lastRainAt - entry.rainSince) / 60_000) + 10;
          events.push([TRIGGERS.STOPPED, { ...base, duration_minutes: minutes }]);
          entry.rainSince = null;
        }
      }
      const near = reading.distanceKm !== null && reading.distanceKm <= config.approach_km;
      // Only a change seen between two frames: never on the first reading.
      if (near && entry.near === false) {
        events.push([TRIGGERS.APPROACHING, { ...base, distance_km: reading.distanceKm }]);
      }
      entry.near = near;
    }
    return events;
  }

  /** Read, draw and publish one place for the current frame. */
  async function processPlace(place, { force = false } = {}) {
    const id = placeId(place);
    const entry = watched.get(id) ?? { near: undefined, dry: 0, rainSince: null };
    watched.set(id, entry);
    let events = [];
    if (entry.framePath !== frame.path || force) {
      const reading = await analyzePlace(sources, frame, place);
      if (entry.framePath !== frame.path) {
        if (entry.framePath !== undefined) {
          events = fireTriggers(place, entry, reading);
        } else {
          // First reading: the state only, no transition.
          entry.near =
            !reading.raining &&
            reading.distanceKm !== null &&
            reading.distanceKm <= config.approach_km;
          entry.rainSince = reading.raining ? frame.time : null;
          entry.lastRainAt = reading.raining ? frame.time : null;
        }
      }
      if (entry.covered !== undefined && entry.covered !== reading.covered) {
        logger.info(`${place.name}: ${reading.covered ? 'back in' : 'outside'} the radar coverage`);
      } else if (entry.covered === undefined && !reading.covered) {
        logger.info(`${place.name}: outside the radar coverage, rain unknown there`);
      }
      entry.covered = reading.covered;
      entry.reading = reading;
      entry.framePath = frame.path;
      entry.frameTime = frame.time;
    }
    if (entry.imageFrame !== frame.path || entry.imageZoom !== config.zoom || force) {
      entry.image = await renderPlace(sources, frame, place, {
        zoom: Number(config.zoom),
        // 24-hour clock: the bitmap font has no AM/PM.
        time: timeOf(frame.time, 'fr'),
        logger,
      });
      entry.imageFrame = frame.path;
      entry.imageZoom = config.zoom;
      entry.imageTime = frame.time;
      await gladys
        .publishCameraImage(
          deviceIds(gladys, place).device,
          `${CAMERA_PREFIX}${entry.image.toString('base64')}`,
        )
        .catch((err) => logger.debug(`Camera image of ${place.name} refused: ${err.message}`));
    }
    await gladys.publishChangedStates(
      buildStates(gladys, place, entry.reading, timeOf(entry.frameTime, config.language)),
      { heartbeat: HEARTBEAT_MS },
    );
    for (const [key, data] of events) {
      logger.info(`${place.name}: ${key}`);
      await gladys
        .publishSceneEvent(key, data)
        .catch((err) => logger.warn(`Scene event ${key} refused: ${err.message}`));
    }
    return entry;
  }

  /** One refresh: frame, then every place added in Gladys. */
  async function cycle({ force = false } = {}) {
    await loadPlaces();
    await fetchFrame();
    const created = createdIds();
    let changed = false;
    for (const place of places.filter((item) => isCreated(item, created))) {
      const before = watched.get(placeId(place))?.imageFrame;
      try {
        const entry = await processPlace(place, { force });
        changed ||= entry.imageFrame !== before;
      } catch (err) {
        logger.warn(`${place.name}: radar not read (${err.message})`);
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
    let entry = watched.get(placeId(place));
    if (!entry?.reading) {
      try {
        if (!frame) {
          await fetchFrame();
        }
        entry = await processPlace(place);
      } catch {
        throw new ActionFailure(FAILURE.unreachable);
      }
    }
    return { place, entry };
  }

  async function check() {
    await loadPlaces();
    if (places.length === 0) {
      throw new ActionFailure(FAILURE.noPlace);
    }
    try {
      await fetchFrame();
    } catch {
      throw new ActionFailure(FAILURE.unreachable);
    }
    await refresh();
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
    config = normalizeConfig(raw);
    await loadPlaces();
    await publishDevices();
    await refresh();
  });

  // Added in Gladys: read it now and send everything (states sent before the
  // device existed were dropped by Gladys).
  gladys.onDeviceCreated(async (device) => {
    const place = placeOf(device?.external_id);
    if (place) {
      // The SDK forgets the published states of a created device by itself.
      if (running) {
        await running;
      }
      // Drawn earlier (the device was deleted, then added again): the cycle
      // will not draw it again for this frame, so its image is sent here.
      const drawnBefore = watched.get(placeId(place))?.image !== undefined;
      await refresh();
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
