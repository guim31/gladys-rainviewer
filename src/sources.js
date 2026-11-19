// -----------------------------------------------------------------------------
// The two tile sources, behind one cache:
//   - RainViewer (public API, no key): the frame list, the radar tiles of the
//     newest frame, the radar coverage mask;
//   - OpenStreetMap (standard tiles): the base map under the radar.
//
// Their terms ask the same thing: cache, and do not hammer. The radar tiles of
// a frame are fetched once, whatever the number of places (they share tiles),
// and dropped when the next frame comes. The coverage mask is kept a day. The
// map tiles are kept 30 days on /data (the OSM tile policy asks 7 days at
// least) and identify the integration in their User-Agent, as it requires.
// -----------------------------------------------------------------------------

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { TILE_SIZE } from './geo.js';

export const MAPS_URL = 'https://api.rainviewer.com/public/weather-maps.json';
export const COVERAGE_URL = 'https://tilecache.rainviewer.com/v2/coverage/0';
export const OSM_URL = 'https://tile.openstreetmap.org';
export const USER_AGENT = 'gladys-rainviewer (+https://github.com/guim31/gladys-rainviewer)';
// The public API serves zoom 7 at most (a deeper tile is a placeholder).
export const MAX_RADAR_ZOOM = 7;
// Universal Blue, the one scheme of the public API; unsmoothed, no snow colors.
const RADAR_STYLE = '2/0_0';

const REQUEST_TIMEOUT_MS = 15_000;
const COVERAGE_TTL_MS = 24 * 3600_000;
const MAP_TTL_MS = 30 * 24 * 3600_000;
// Decoded map tiles kept in memory: 256 KB each.
const MAP_MEMORY_TILES = 48;

/** A failure to reach a source. `kind`: `network`, `http` or `format`. */
export class SourceError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

/**
 * @param {object} options - Options.
 * @param {Function} [options.fetch] - The fetch implementation.
 * @param {Function} [options.now] - Clock, in ms.
 * @param {string|null} [options.cacheDir] - Where the map tiles are kept (null: memory only).
 * @param {object} [options.logger] - Logger.
 * @returns {object} The sources.
 */
export function createSources({
  fetch = globalThis.fetch,
  now = Date.now,
  cacheDir = null,
  logger = console,
} = {}) {
  let radarFramePath = null;
  const radarTiles = new Map();
  const coverageTiles = new Map();
  const mapTiles = new Map();
  let cacheDirReady = null;
  let cacheDirBroken = false;

  async function get(url) {
    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      throw new SourceError('network', `${new URL(url).host}: ${err.cause?.code ?? err.message}`);
    }
    if (!response.ok) {
      throw new SourceError('http', `${new URL(url).host}: HTTP ${response.status}`);
    }
    return response;
  }

  function decode(buffer, url) {
    try {
      const png = PNG.sync.read(buffer);
      return { width: png.width, height: png.height, data: png.data };
    } catch {
      throw new SourceError('format', `${new URL(url).host}: not a PNG tile`);
    }
  }

  async function png(url) {
    const response = await get(url);
    return decode(Buffer.from(await response.arrayBuffer()), url);
  }

  /**
   * The newest radar frame.
   * @returns {Promise<{ host: string, path: string, time: number }>} `time` in ms.
   */
  async function latestFrame() {
    const response = await get(MAPS_URL);
    let body;
    try {
      body = await response.json();
    } catch {
      throw new SourceError('format', 'api.rainviewer.com: not JSON');
    }
    const past = Array.isArray(body?.radar?.past) ? body.radar.past : [];
    const frame = past
      .filter((item) => Number.isFinite(item?.time) && typeof item?.path === 'string')
      .sort((a, b) => a.time - b.time)
      .at(-1);
    if (!frame || typeof body.host !== 'string' || !/^https:\/\//.test(body.host)) {
      throw new SourceError('format', 'api.rainviewer.com: no radar frame');
    }
    return { host: body.host, path: frame.path, time: frame.time * 1000 };
  }

  /** One radar tile of a frame (decoded RGBA, `data: null` when empty). */
  async function radarTile(frame, zoom, x, y) {
    if (frame.path !== radarFramePath) {
      radarFramePath = frame.path;
      radarTiles.clear();
    }
    const key = `${zoom}/${x}/${y}`;
    if (!radarTiles.has(key)) {
      const url = `${frame.host}${frame.path}/${TILE_SIZE}/${zoom}/${x}/${y}/${RADAR_STYLE}.png`;
      // Shared by the places that ask for it at the same time; forgotten on failure.
      const pending = png(url).catch((err) => {
        if (radarTiles.get(key) === pending) {
          radarTiles.delete(key);
        }
        throw err;
      });
      radarTiles.set(key, pending);
    }
    return radarTiles.get(key);
  }

  /** One tile of the radar coverage mask: opaque where no radar sees. */
  async function coverageTile(zoom, x, y) {
    const key = `${zoom}/${x}/${y}`;
    const cached = coverageTiles.get(key);
    if (cached && now() - cached.at < COVERAGE_TTL_MS) {
      return cached.tile;
    }
    const tile = await png(`${COVERAGE_URL}/${TILE_SIZE}/${zoom}/${x}/${y}/0/0_0.png`);
    coverageTiles.set(key, { tile, at: now() });
    return tile;
  }

  async function ensureCacheDir() {
    if (!cacheDir || cacheDirBroken) {
      return false;
    }
    cacheDirReady ??= mkdir(cacheDir, { recursive: true }).then(
      () => true,
      (err) => {
        cacheDirBroken = true;
        logger.warn(`Map tiles not cached on disk (${err.code ?? err.message})`);
        return false;
      },
    );
    return cacheDirReady;
  }

  async function readCachedMap(file) {
    try {
      const info = await stat(file);
      if (now() - info.mtimeMs > MAP_TTL_MS) {
        return null;
      }
      return await readFile(file);
    } catch {
      return null;
    }
  }

  // Downloads in flight, shared by the places that need the same tile.
  const mapPending = new Map();

  /** One OpenStreetMap tile, from memory, from /data, or downloaded (shared). */
  function mapTile(zoom, x, y) {
    const key = `${zoom}-${x}-${y}`;
    if (!mapPending.has(key)) {
      mapPending.set(
        key,
        loadMapTile(zoom, x, y).finally(() => mapPending.delete(key)),
      );
    }
    return mapPending.get(key);
  }

  async function loadMapTile(zoom, x, y) {
    const key = `${zoom}-${x}-${y}`;
    const memory = mapTiles.get(key);
    if (memory && now() - memory.at < MAP_TTL_MS) {
      mapTiles.delete(key);
      mapTiles.set(key, memory);
      return memory.tile;
    }
    const url = `${OSM_URL}/${zoom}/${x}/${y}.png`;
    const file = (await ensureCacheDir()) ? join(cacheDir, `${key}.png`) : null;
    const cached = file ? await readCachedMap(file) : null;
    let tile = null;
    if (cached) {
      try {
        tile = decode(cached, url);
      } catch {
        // A damaged file: downloaded again below.
      }
    }
    if (!tile) {
      const buffer = Buffer.from(await (await get(url)).arrayBuffer());
      tile = decode(buffer, url);
      if (file) {
        await writeFile(file, buffer).catch((err) =>
          logger.debug(`Map tile not written: ${err.code ?? err.message}`),
        );
      }
    }
    mapTiles.set(key, { tile, at: now() });
    while (mapTiles.size > MAP_MEMORY_TILES) {
      mapTiles.delete(mapTiles.keys().next().value);
    }
    return tile;
  }

  return { latestFrame, radarTile, coverageTile, mapTile };
}
