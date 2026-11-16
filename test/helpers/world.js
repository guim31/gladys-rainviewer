// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, a simulated RainViewer and
// OpenStreetMap (tiles drawn from rain "cells" placed on the map), and the
// integration wired on top. No timer runs: the tests call app.refresh().
// -----------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import { PNG } from 'pngjs';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createApp } from '../../src/app.js';
import { TILE_SIZE, kmPerPixel, worldPixel } from '../../src/geo.js';
import { UNIVERSAL_BLUE } from '../../src/palette.js';
import { MAPS_URL } from '../../src/sources.js';

process.env.LOG_LEVEL ??= 'silent';

export const HOST = 'https://tilecache.rainviewer.com';
export const T0 = Date.UTC(2026, 10, 16, 15, 20);

export const HOME = {
  id: 'a0f5d0c4-1111-4c3b-9a55-0123456789ab',
  name: 'Maison',
  selector: 'maison',
  latitude: 45.75,
  longitude: 4.85,
};

const colorOf = (dbz) => {
  const [, rgba] = UNIVERSAL_BLUE.find(([value]) => value >= dbz) ?? UNIVERSAL_BLUE.at(-1);
  return [(rgba >>> 24) & 0xff, (rgba >>> 16) & 0xff, (rgba >>> 8) & 0xff, rgba & 0xff];
};

const encode = (width, height, paint) => {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rgba = paint(x, y);
      if (rgba) {
        png.data.set(rgba, (y * width + x) * 4);
      }
    }
  }
  return PNG.sync.write(png);
};

/** Pixels of a tile that fall inside one of the discs (`{ latitude, longitude, km }`). */
function discPainter(discs, zoom, tx, ty, inside) {
  const scaled = discs.map((disc) => {
    const center = worldPixel(disc.latitude, disc.longitude, zoom);
    return { ...disc, center, radius: disc.km / kmPerPixel(disc.latitude, zoom) };
  });
  return (x, y) => {
    const px = tx * TILE_SIZE + x + 0.5;
    const py = ty * TILE_SIZE + y + 0.5;
    const hit = scaled.find(
      (disc) => (px - disc.center.x) ** 2 + (py - disc.center.y) ** 2 <= disc.radius ** 2,
    );
    return hit ? inside(hit) : null;
  };
}

export class FakeRainViewer {
  constructor() {
    // Rain cells: `{ latitude, longitude, km, dbz }`.
    this.cells = [];
    // Areas no radar sees: `{ latitude, longitude, km }`.
    this.uncovered = [];
    this.frame = 0;
    this.down = false;
    this.mapDown = false;
    this.requests = [];
    this.fetch = this.fetch.bind(this);
  }

  /** The next radar frame (10 minutes later), with new cells. */
  nextFrame(cells = this.cells) {
    this.frame += 1;
    this.cells = cells;
  }

  get frameTime() {
    return T0 / 1000 + this.frame * 600;
  }

  framePath(frame = this.frame) {
    return `/v2/radar/frame${String(frame).padStart(6, '0')}`;
  }

  async fetch(url, init = {}) {
    this.requests.push({ url, userAgent: init.headers?.['User-Agent'] });
    if (this.down || (this.mapDown && url.includes('openstreetmap'))) {
      throw new TypeError('fetch failed');
    }
    if (url === MAPS_URL) {
      const past = [];
      for (let k = Math.max(0, this.frame - 12); k <= this.frame; k += 1) {
        past.push({ time: T0 / 1000 + k * 600, path: this.framePath(k) });
      }
      return Response.json({
        version: '2.0',
        generated: this.frameTime + 30,
        host: HOST,
        radar: { past, nowcast: [] },
        satellite: { infrared: [] },
      });
    }
    let match = /\/v2\/radar\/frame(\d+)\/256\/(\d+)\/(\d+)\/(\d+)\/2\/0_0\.png$/.exec(url);
    if (match) {
      const [, , z, x, y] = match.map(Number);
      const paint = discPainter(this.cells, z, x, y, (cell) => colorOf(cell.dbz));
      return new Response(encode(TILE_SIZE, TILE_SIZE, paint));
    }
    match = /\/v2\/coverage\/0\/256\/(\d+)\/(\d+)\/(\d+)\/0\/0_0\.png$/.exec(url);
    if (match) {
      const [, z, x, y] = match.map(Number);
      const paint = discPainter(this.uncovered, z, x, y, () => [0, 0, 0, 255]);
      return new Response(encode(TILE_SIZE, TILE_SIZE, paint));
    }
    if (/^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/.test(url)) {
      this.mapTile ??= encode(TILE_SIZE, TILE_SIZE, (x, y) =>
        (x + y) % 32 === 0 ? [170, 170, 170, 255] : [242, 239, 233, 255],
      );
      return new Response(this.mapTile);
    }
    return new Response('not found', { status: 404 });
  }
}

/** Replays the RainViewer answers recorded in test/fixtures/rainviewer. */
export async function recordedFetch() {
  const dir = new URL('../fixtures/rainviewer/', import.meta.url);
  const index = JSON.parse(await readFile(new URL('index.json', dir), 'utf8'));
  const fetch = async (url) => {
    const name = index.files[url];
    if (!name) {
      return new Response('not recorded', { status: 404 });
    }
    return new Response(await readFile(new URL(name, dir)));
  };
  return { fetch, index };
}

/** A logger that records what it writes, by level. */
export function recordingLogger() {
  const lines = [];
  const log =
    (level) =>
    (...args) =>
      lines.push({ level, text: args.map(String).join(' ') });
  return {
    lines,
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
  };
}

export async function settle() {
  for (let round = 0; round < 10; round += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options] - Options.
 * @returns {Promise<object>} `{ gladys, fake, server, app, clock, logger }`.
 */
export async function createWorld({
  server = new FakeRainViewer(),
  config = {},
  houses = [HOME],
  created = [],
  connect = true,
  logger = recordingLogger(),
} = {}) {
  const clock = { now: T0 + 60_000 };
  const gladys = createFakeGladys({ config, houses, devices: created });
  const app = createApp(gladys, {
    fetch: server.fetch,
    now: () => clock.now,
    cacheDir: null,
    timers: false,
    logger,
  });
  const world = { gladys, fake: gladys.fake, server, app, clock, logger };
  if (connect) {
    await gladys.connect();
    await settle();
    await app.refresh();
  }
  return world;
}

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
  await world.app.refresh();
}

/** The next frame, 10 minutes later, and a refresh. */
export async function nextFrame(world, cells) {
  world.server.nextFrame(cells);
  world.clock.now += 600_000;
  await world.app.refresh();
}
