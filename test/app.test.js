// -----------------------------------------------------------------------------
// The integration end to end, against the SDK's fake Gladys and a simulated
// RainViewer: discovery, states, camera images, scene triggers, outage.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HEARTBEAT_MS, OUTAGE_MS } from '../src/app.js';
import { CONNECTION_TEXT } from '../src/texts.js';
import { MAX_CAMERA_IMAGE } from '../src/radar.js';
import { HOME, createAll, createWorld, nextFrame, settle } from './helpers/world.js';

const RAIN_OVER_HOME = { latitude: HOME.latitude, longitude: HOME.longitude, km: 10, dbz: 30 };
// A cell whose edge is about `km` from the house, to the west.
const cellAt = (km, radius = 5) => ({
  latitude: HOME.latitude,
  longitude: HOME.longitude - (km + radius) / (111.32 * Math.cos((HOME.latitude * Math.PI) / 180)),
  km: radius,
  dbz: 25,
});

const statesOf = (fake, key) =>
  fake.states.filter((state) => state.device_feature_external_id.endsWith(`:${key}`));
const last = (fake, key) => statesOf(fake, key).at(-1);
const events = (fake, key) => fake.sceneEvents.filter((event) => event.key === key);

test('one device per located house and per other place, nothing read before it is added', async () => {
  const { fake, server } = await createWorld({
    config: { extra_places: 'Chalet: 45,92 6,87; nowhere; Office: 48.8566, 2.3522' },
    houses: [HOME, { id: 'b1', name: 'Boat', selector: 'boat', latitude: null, longitude: null }],
  });
  assert.deepEqual(
    fake.discoveredDevices.map((device) => [device.name, device.external_id]),
    [
      ['Maison', `ext:test-integration:place:house-${HOME.id}`],
      ['Chalet', 'ext:test-integration:place:place-chalet'],
      ['Office', 'ext:test-integration:place:place-office'],
    ],
  );
  assert.equal(fake.states.length, 0);
  assert.equal(fake.cameraImages.length, 0);
  // The frame list only: no tile for places nobody added.
  assert.ok(server.requests.every((request) => request.url.endsWith('weather-maps.json')));
});

test('an added place gets its states, its radar image and a widget refresh at once', async () => {
  const server = (await createWorld({ connect: false })).server;
  server.cells = [RAIN_OVER_HOME];
  const world = await createWorld({ server });
  await createAll(world);
  const { fake } = world;
  assert.equal(last(fake, 'rain').state, 1);
  assert.ok(last(fake, 'rate').state > 1);
  assert.equal(last(fake, 'distance').state, 0);
  assert.match(last(fake, 'radar_time').text, /^\d\d:\d\d$/);
  assert.equal(fake.cameraImages.length, 1, 'one image per frame, not one more on creation');
  const image = fake.cameraImages.at(-1).image;
  assert.match(image, /^image\/jpg;base64,\/9j\//);
  assert.ok(image.length <= MAX_CAMERA_IMAGE);
  assert.ok(fake.widgetRefreshes.length >= 1);
  // Map tiles are asked with the integration's User-Agent (OSM tile policy).
  const osm = server.requests.find((request) => request.url.includes('openstreetmap'));
  assert.match(osm.userAgent, /gladys-rainviewer/);
});

test('a new frame publishes only what changed, with a heartbeat for stable values', async () => {
  const world = await createWorld();
  const calls = [];
  const publish = world.gladys.publishChangedStates.bind(world.gladys);
  world.gladys.publishChangedStates = (states, options) => {
    calls.push(options);
    return publish(states, options);
  };
  await createAll(world);
  const { fake } = world;
  assert.equal(last(fake, 'rain').state, 0);
  assert.equal(last(fake, 'distance').state, 50);
  const count = statesOf(fake, 'rain').length;
  await nextFrame(world);
  assert.equal(statesOf(fake, 'rain').length, count, 'unchanged: not re-sent');
  // Gladys shows a value older than 48 h as stale: re-sent well before.
  assert.ok(calls.length > 0);
  assert.ok(calls.every((options) => options.heartbeat === HEARTBEAT_MS));
  assert.ok(HEARTBEAT_MS <= 12 * 3600_000);
});

test('rain approaching fires once when rain crosses the distance, never on the first reading', async () => {
  const server = (await createWorld({ connect: false })).server;
  server.cells = [cellAt(8)];
  const world = await createWorld({ server, config: { approach_km: 15 } });
  await createAll(world);
  const { fake } = world;
  assert.equal(events(fake, 'rain_approaching').length, 0, 'already near at start: no event');

  await nextFrame(world, [cellAt(30)]);
  assert.equal(events(fake, 'rain_approaching').length, 0);
  await nextFrame(world, [cellAt(12)]);
  const [event] = events(fake, 'rain_approaching');
  assert.ok(event, 'fired');
  assert.equal(event.data.place, `ext:test-integration:place:house-${HOME.id}`);
  assert.equal(event.data.place_name, 'Maison');
  assert.ok(Math.abs(event.data.distance_km - 12) <= 2, `distance ${event.data.distance_km}`);
  await nextFrame(world, [cellAt(5)]);
  assert.equal(events(fake, 'rain_approaching').length, 1, 'still near: no repeat');
});

test('rain stopped fires after two dry frames, with the duration of the rain', async () => {
  const world = await createWorld();
  await createAll(world);
  const { fake } = world;
  await nextFrame(world, [RAIN_OVER_HOME]);
  await nextFrame(world, [RAIN_OVER_HOME]);
  await nextFrame(world, []);
  assert.equal(events(fake, 'rain_stopped').length, 0, 'one dry frame is not enough');
  await nextFrame(world, []);
  const [event] = events(fake, 'rain_stopped');
  assert.ok(event);
  assert.equal(event.data.duration_minutes, 20);
  await nextFrame(world, []);
  assert.equal(events(fake, 'rain_stopped').length, 1);
  assert.equal(last(fake, 'rain').state, 0);
});

test('outside radar coverage: the time only, no rain value, no trigger', async () => {
  const server = (await createWorld({ connect: false })).server;
  server.uncovered = [{ latitude: HOME.latitude, longitude: HOME.longitude, km: 100 }];
  const world = await createWorld({ server });
  await createAll(world);
  const { fake, logger } = world;
  assert.equal(statesOf(fake, 'rain').length, 0);
  assert.equal(statesOf(fake, 'radar_time').length, 1);
  assert.ok(
    logger.lines.some((line) => line.level === 'info' && /outside the radar/.test(line.text)),
  );
  const outside = await fake.sceneAction('get_rain', {
    place: fake.discoveredDevices[0].external_id,
  });
  assert.equal(outside.success, false);
  assert.match(outside.error.es, /fuera de la cobertura/);
});

test('RainViewer down: one warning, the connection status after 30 minutes, then back', async () => {
  const world = await createWorld();
  await createAll(world);
  const { fake, server, logger, app, clock } = world;
  server.down = true;
  for (let k = 0; k < 4; k += 1) {
    clock.now += 5 * 60_000;
    await app.refresh();
  }
  assert.equal(logger.lines.filter((line) => line.level === 'warn').length, 1);
  assert.equal(fake.connectionStatuses.filter((status) => status.connected === false).length, 0);
  clock.now += OUTAGE_MS;
  await app.refresh();
  const down = fake.connectionStatuses.filter((status) => status.connected === false);
  assert.equal(down.length, 1);
  assert.deepEqual(down[0].message, CONNECTION_TEXT.unreachable);
  server.down = false;
  await nextFrame(world);
  assert.equal(fake.connectionStatuses.at(-1).connected, true);
  assert.ok(logger.lines.some((line) => line.level === 'info' && /answers again/.test(line.text)));
});

test('a normal cycle writes nothing at info level', async () => {
  const world = await createWorld();
  await createAll(world);
  world.logger.lines.length = 0;
  await nextFrame(world, [RAIN_OVER_HOME]);
  await nextFrame(world, [RAIN_OVER_HOME]);
  assert.deepEqual(
    world.logger.lines.filter((line) => line.level !== 'debug'),
    [],
  );
});

test('the map down: the radar is still drawn, on a grey background', async () => {
  const server = (await createWorld({ connect: false })).server;
  server.mapDown = true;
  const world = await createWorld({ server });
  await createAll(world);
  assert.ok(world.fake.cameraImages.length >= 1);
});

test('onGetImage answers with the newest picture', async () => {
  const world = await createWorld();
  await createAll(world);
  const [device] = world.fake.discoveredDevices;
  const image = await world.fake.getImage(device);
  assert.match(image.data?.image ?? image.image ?? image, /^image\/jpg;base64,/);
});

test('scene action get_rain: outputs on success, a red multi-language failure otherwise', async () => {
  const world = await createWorld();
  world.server.cells = [RAIN_OVER_HOME];
  await createAll(world);
  const place = world.fake.discoveredDevices[0].external_id;
  const ok = await world.fake.sceneAction('get_rain', { place });
  assert.equal(ok.success, true);
  assert.equal(ok.data.outputs.raining, true);
  assert.equal(ok.data.outputs.distance_km, 0);
  assert.ok(ok.data.outputs.rate > 0);
  assert.match(ok.data.outputs.radar_time, /^\d\d:\d\d$/);

  const missing = await world.fake.sceneAction('get_rain', {
    place: 'ext:test-integration:place:x',
  });
  assert.equal(missing.success, false);
  assert.match(missing.error.fr, /n’est plus surveillé/);
});

test('action check: a report per place; red when RainViewer is down or no place is located', async () => {
  const world = await createWorld();
  await createAll(world);
  const ok = await world.fake.action('check');
  assert.equal(ok.success, true);
  assert.match(ok.data.message.fr, /RainViewer répond/);
  assert.match(ok.data.message.fr, /- Maison: sec à 50 km/);
  world.server.down = true;
  const down = await world.fake.action('check');
  assert.equal(down.success, false);
  assert.match(down.error.fr, /RainViewer ne répond pas/);

  const empty = await createWorld({ houses: [] });
  const none = await empty.fake.action('check');
  assert.equal(none.success, false);
  assert.match(none.error.de, /Kein Ort/);
});

test('widget: image, rain and nearest rain, valid content; the image can be hidden', async () => {
  const world = await createWorld();
  world.server.cells = [cellAt(10)];
  await createAll(world);
  const [device] = world.fake.discoveredDevices;
  const answer = await world.fake.widgetGet('rain_radar', {
    settings: { place: device.external_id, show_image: true },
    language: 'fr',
  });
  assert.equal(answer.success, true);
  const { content } = answer.data;
  assert.deepEqual(validateWidgetContent(content).errors ?? [], []);
  const types = content.components.map((component) => component.type);
  assert.deepEqual(types, ['text', 'image', 'status']);
  assert.match(content.components[0].text, /RainViewer/);
  const status = content.components[2].items;
  assert.equal(status[0].value, 'Non');
  assert.match(status[1].value, /^\d+ km$/);
  assert.equal(status[1].color, 'warning');

  const image = await world.fake.widgetGetImage(content.components[1].key);
  assert.equal(image.success, true);
  assert.equal(Buffer.from(image.data.image, 'base64').subarray(0, 2).toString('hex'), 'ffd8');

  const small = await world.fake.widgetGet('rain_radar', {
    settings: { place: device.external_id, show_image: false },
  });
  assert.deepEqual(
    small.data.content.components.map((component) => component.type),
    ['text', 'status'],
  );
  const pick = await world.fake.widgetGet('rain_radar', { settings: {} });
  assert.match(pick.data.content.components[0].text, /Choose a place/);
});

test('a reconnection does not repeat the triggers of the current frame', async () => {
  const world = await createWorld();
  await createAll(world);
  await nextFrame(world, [cellAt(30)]);
  await nextFrame(world, [cellAt(10)]);
  await world.app.refresh();
  await settle();
  assert.equal(events(world.fake, 'rain_approaching').length, 1);
});

test('a place deleted then added again gets its image back at once', async () => {
  const world = await createWorld();
  await createAll(world);
  const [device] = world.fake.discoveredDevices;
  await world.fake.deviceDeleted(device);
  await world.fake.deviceCreated(device);
  await settle();
  assert.equal(world.fake.cameraImages.length, 2);
  assert.equal(statesOf(world.fake, 'rain').length, 2, 'states re-sent');
});

test('started under the rain, rain moving away close by is no "rain approaching"', async () => {
  const server = (await createWorld({ connect: false })).server;
  server.cells = [RAIN_OVER_HOME];
  const world = await createWorld({ server });
  await createAll(world);
  await nextFrame(world, [cellAt(3)]);
  assert.equal(events(world.fake, 'rain_approaching').length, 0);
});

test('a shower that starts within one frame is "rain approaching" at 0 km', async () => {
  const world = await createWorld();
  await createAll(world);
  await nextFrame(world, [RAIN_OVER_HOME]);
  const [event] = events(world.fake, 'rain_approaching');
  assert.equal(event?.data.distance_km, 0);
});

test('a state refused by Gladys does not lose the scene event', async () => {
  const world = await createWorld();
  await createAll(world);
  world.gladys.publishChangedStates = async () => {
    throw new Error('HTTP 429');
  };
  await nextFrame(world, [cellAt(30)]);
  await nextFrame(world, [cellAt(10)]);
  assert.equal(events(world.fake, 'rain_approaching').length, 1);
});

test('a new "rain approaching" distance fires nothing by itself', async () => {
  const world = await createWorld({ config: { approach_km: 5 } });
  world.server.cells = [cellAt(10)];
  await createAll(world);
  await world.fake.configUpdated({ approach_km: 15 });
  await settle();
  await nextFrame(world);
  assert.equal(events(world.fake, 'rain_approaching').length, 0);
});

test('the coverage mask down: the rain is still read', async () => {
  const server = (await createWorld({ connect: false })).server;
  const fetch = server.fetch;
  server.fetch = async (url, init) => {
    if (url.includes('/coverage/')) {
      return new Response('', { status: 502 });
    }
    return fetch(url, init);
  };
  server.cells = [RAIN_OVER_HOME];
  const world = await createWorld({ server });
  await createAll(world);
  assert.equal(last(world.fake, 'rain').state, 1);
});

test('RainViewer down for an hour: the scene action fails instead of an old reading', async () => {
  const world = await createWorld();
  await createAll(world);
  const place = world.fake.discoveredDevices[0].external_id;
  world.server.down = true;
  world.clock.now += 60 * 60_000;
  const answer = await world.fake.sceneAction('get_rain', { place });
  assert.equal(answer.success, false);
  assert.match(answer.error.en, /RainViewer does not answer/);
});

test('a weak frame inside a rain episode is no "rain approaching" when the rain comes back', async () => {
  const world = await createWorld();
  await createAll(world);
  await nextFrame(world, [RAIN_OVER_HOME]);
  const before = events(world.fake, 'rain_approaching').length;
  await nextFrame(world, []);
  await nextFrame(world, [RAIN_OVER_HOME]);
  assert.equal(events(world.fake, 'rain_approaching').length, before);
});
