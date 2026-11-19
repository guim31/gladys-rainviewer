// -----------------------------------------------------------------------------
// The radar reading, on tiles RECORDED from the real RainViewer API (Bordeaux,
// raining, 16/11/2026: test/fixtures/rainviewer), and its building blocks.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlaces, normalizeConfig, DEFAULT_CONFIG } from '../src/config.js';
import { kmPerPixel, tilesFor, worldPixel } from '../src/geo.js';
import { pixelDbz, rainRate, UNIVERSAL_BLUE } from '../src/palette.js';
import { analyzePlace, CAMERA_PREFIX, MAX_CAMERA_IMAGE, renderPlace } from '../src/radar.js';
import { createSources, SourceError } from '../src/sources.js';
import { recordedFetch } from './helpers/world.js';

test('the recorded Bordeaux frame reads as rain, about 2 mm/h', async () => {
  const { fetch, index } = await recordedFetch();
  const sources = createSources({ fetch, cacheDir: null });
  const frame = await sources.latestFrame();
  assert.equal(frame.path, '/v2/radar/df09895a0674');
  const reading = await analyzePlace(sources, frame, index.place);
  assert.deepEqual(reading, index.expected);
  assert.deepEqual(reading, { covered: true, dbz: 28, raining: true, rate: 2.1, distanceKm: 0 });
});

test('every pixel of the recorded radar tiles is a Universal Blue color', async () => {
  const { fetch, index } = await recordedFetch();
  const { PNG } = await import('pngjs');
  const exact = new Set(UNIVERSAL_BLUE.map(([, rgba]) => rgba >>> 0));
  let echoes = 0;
  for (const [url] of Object.entries(index.files).filter(([url]) => url.includes('/radar/'))) {
    const png = PNG.sync.read(Buffer.from(await (await fetch(url)).arrayBuffer()));
    for (let i = 0; i < png.data.length; i += 4) {
      const [r, g, b, a] = png.data.subarray(i, i + 4);
      if (a > 0) {
        echoes += 1;
        assert.ok(exact.has(((r << 24) | (g << 16) | (b << 8) | a) >>> 0), `${r},${g},${b},${a}`);
      }
    }
  }
  assert.ok(echoes > 10_000);
});

test('the radar picture of the recorded frame is a camera JPEG under 150 KB', async () => {
  const { fetch: recorded, index } = await recordedFetch();
  const { PNG } = await import('pngjs');
  const blank = PNG.sync.write(new PNG({ width: 256, height: 256 }));
  // Only the tiles around the place were recorded: the others are empty, and
  // the map is down (the radar is drawn on grey).
  const fetch = async (url) => {
    if (url.includes('openstreetmap')) {
      throw new TypeError('fetch failed');
    }
    const response = await recorded(url);
    return response.ok ? response : new Response(blank);
  };
  const sources = createSources({ fetch, cacheDir: null });
  const frame = await sources.latestFrame();
  const jpeg = await renderPlace(sources, frame, index.place, {
    zoom: 7,
    time: '16:20',
    logger: { debug() {} },
  });
  assert.equal(jpeg.subarray(0, 2).toString('hex'), 'ffd8');
  assert.ok(CAMERA_PREFIX.length + Math.ceil(jpeg.length / 3) * 4 <= MAX_CAMERA_IMAGE);
});

test('palette: exact colors, transparent, unknown colors, Marshall-Palmer rates', () => {
  assert.equal(pixelDbz(0x00, 0xa3, 0xe0, 0xff), 20);
  assert.equal(pixelDbz(0, 0, 0, 0), null);
  assert.equal(pixelDbz(0x01, 0xa4, 0xdf, 0xff), 20, 'a near color');
  assert.equal(pixelDbz(0, 0, 0, 255), null, 'black is no echo');
  assert.equal(rainRate(null), 0);
  assert.equal(rainRate(10), 0, 'below the rain threshold');
  assert.equal(rainRate(15), 0.3);
  assert.equal(rainRate(30), 2.7);
  assert.equal(rainRate(50), 48.6);
});

test('geo: Web Mercator pixels, scale, tiles across the antimeridian', () => {
  const paris = worldPixel(48.8566, 2.3522, 7);
  assert.equal(Math.floor(paris.x / 256), 64);
  assert.equal(Math.floor(paris.y / 256), 44);
  assert.ok(Math.abs(kmPerPixel(0, 7) - 1.2216) < 0.001);
  const tiles = tilesFor(-10, 100, 20, 20, 1);
  assert.deepEqual(
    tiles.map((tile) => [tile.x, tile.y]),
    [
      [1, 0],
      [0, 0],
    ],
  );
  assert.deepEqual(tilesFor(0, -300, 10, 10, 1), [], 'beyond the pole');
});

test('other places: names, decimal commas, bad entries reported', () => {
  const { places, errors } = parsePlaces(
    'Bureau : 48.8566, 2.3522 ; Chalet: 45,92 6,87\nBad: 95, 2; : 1, 2; Nowhere; bureau: 1, 1; Châlet: 1, 1',
  );
  assert.deepEqual(places, [
    { name: 'Bureau', latitude: 48.8566, longitude: 2.3522 },
    { name: 'Chalet', latitude: 45.92, longitude: 6.87 },
  ]);
  assert.deepEqual(errors, ['Bad: 95, 2', ': 1, 2', 'Nowhere', 'bureau: 1, 1', 'Châlet: 1, 1']);
});

test('config: defaults and bounds', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  const config = normalizeConfig({ language: 'xx', zoom: 9, approach_km: '200' });
  assert.equal(config.language, 'fr');
  assert.equal(config.zoom, '7');
  assert.equal(config.approach_km, 50);
  assert.equal(normalizeConfig({ approach_km: 'abc' }).approach_km, 15);
  assert.equal(normalizeConfig({ zoom: 5 }).zoom, '5');
});

test('sources: network, HTTP and format failures are typed', async () => {
  const down = createSources({
    fetch: async () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(
    down.latestFrame(),
    (err) => err instanceof SourceError && err.kind === 'network',
  );
  const http = createSources({ fetch: async () => new Response('', { status: 503 }) });
  await assert.rejects(http.latestFrame(), (err) => err.kind === 'http' && /503/.test(err.message));
  const empty = createSources({
    fetch: async () => Response.json({ host: 'https://x.test', radar: { past: [] } }),
  });
  await assert.rejects(empty.latestFrame(), (err) => err.kind === 'format');
});
