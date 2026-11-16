// -----------------------------------------------------------------------------
// What the radar says about one place, and the picture of it.
//
// analyzePlace reads the newest frame at the radar's finest zoom (7, about
// 1 km per pixel in Europe): the rain over the place (the strongest echo
// within one pixel around it), and the distance to the nearest rain within
// WATCH_RADIUS_KM. renderPlace draws the radar over the OpenStreetMap map,
// centered on the place, as the JPEG a Gladys camera takes.
// -----------------------------------------------------------------------------

import jpeg from 'jpeg-js';
import { drawText, GLYPH_HEIGHT, textWidth } from './font.js';
import { kmPerPixel, TILE_SIZE, tilesFor, worldPixel } from './geo.js';
import { pixelDbz, RAIN_THRESHOLD_DBZ, rainRate } from './palette.js';
import { MAX_RADAR_ZOOM } from './sources.js';

export const WATCH_RADIUS_KM = 50;
export const IMAGE_WIDTH = 640;
export const IMAGE_HEIGHT = 360; // 16:9, the frame of a Gladys widget image
// A Gladys camera image: an `image/jpg;base64,` string of 150 KB at most.
export const CAMERA_PREFIX = 'image/jpg;base64,';
export const MAX_CAMERA_IMAGE = 150 * 1024;
const JPEG_QUALITIES = [80, 70, 60, 50, 40];
// The map is washed out, so the radar colors stand out.
const MAP_WASH = 0.45;
const NO_MAP_GREY = 228;

/** Read the tiles covering a rectangle into a lookup `(px, py) => [r, g, b, a] | null`. */
async function mosaic(loadTile, left, top, width, height, zoom) {
  const tiles = tilesFor(left, top, width, height, zoom);
  const loaded = new Map();
  await Promise.all(
    tiles.map(async (tile) => {
      loaded.set(`${tile.tx}/${tile.ty}`, await loadTile(zoom, tile.x, tile.y));
    }),
  );
  return (px, py) => {
    const tx = Math.floor(px / TILE_SIZE);
    const ty = Math.floor(py / TILE_SIZE);
    const tile = loaded.get(`${tx}/${ty}`);
    if (!tile?.data) {
      return null;
    }
    const x = Math.floor(px - tx * TILE_SIZE);
    const y = Math.floor(py - ty * TILE_SIZE);
    const i = (y * tile.width + x) * 4;
    return tile.data.subarray(i, i + 4);
  };
}

/**
 * The rain over a place and around it.
 * @param {object} sources - From createSources.
 * @param {object} frame - From sources.latestFrame().
 * @param {{ latitude: number, longitude: number }} place - The place.
 * @returns {Promise<object>} `{ covered, dbz, raining, rate, distanceKm }`;
 * `distanceKm` is null when no rain falls within WATCH_RADIUS_KM.
 */
export async function analyzePlace(sources, frame, place) {
  const zoom = MAX_RADAR_ZOOM;
  const center = worldPixel(place.latitude, place.longitude, zoom);
  const kmPx = kmPerPixel(place.latitude, zoom);
  const radius = Math.ceil(WATCH_RADIUS_KM / kmPx);
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const left = cx - radius;
  const top = cy - radius;
  const size = radius * 2 + 1;
  const [radar, coverage] = await Promise.all([
    mosaic((z, x, y) => sources.radarTile(frame, z, x, y), left, top, size, size, zoom),
    mosaic((z, x, y) => sources.coverageTile(z, x, y), left, top, size, size, zoom),
  ]);

  const mask = coverage(cx, cy);
  // Opaque where no radar sees; a missing mask tile is taken as covered.
  const covered = !mask || mask[3] === 0;

  let dbz = null;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const pixel = radar(cx + dx, cy + dy);
      const value = pixel ? pixelDbz(pixel[0], pixel[1], pixel[2], pixel[3]) : null;
      if (value !== null && (dbz === null || value > dbz)) {
        dbz = value;
      }
    }
  }
  const raining = dbz !== null && dbz >= RAIN_THRESHOLD_DBZ;

  let distanceKm = raining ? 0 : null;
  if (!raining) {
    let best = Infinity;
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const d2 = dx * dx + dy * dy;
        if (d2 > radius * radius || d2 >= best) {
          continue;
        }
        const pixel = radar(cx + dx, cy + dy);
        if (pixel && pixel[3] > 0) {
          const value = pixelDbz(pixel[0], pixel[1], pixel[2], pixel[3]);
          if (value !== null && value >= RAIN_THRESHOLD_DBZ) {
            best = d2;
          }
        }
      }
    }
    if (best !== Infinity) {
      const km = Math.sqrt(best) * kmPx;
      distanceKm = km <= WATCH_RADIUS_KM ? Math.max(1, Math.round(km)) : null;
    }
  }
  return { covered, dbz, raining, rate: rainRate(dbz), distanceKm };
}

/** Encode under the camera limit, lowering the quality as needed. */
export function encodeCameraJpeg(bitmap) {
  for (const quality of JPEG_QUALITIES) {
    const encoded = jpeg.encode(bitmap, quality).data;
    if (CAMERA_PREFIX.length + Math.ceil(encoded.length / 3) * 4 <= MAX_CAMERA_IMAGE) {
      return Buffer.from(encoded);
    }
  }
  throw new Error('The radar image does not fit in 150 KB');
}

/**
 * The radar picture of a place: the map, the rain, a cross on the place, the
 * frame time and the attributions.
 * @param {object} sources - From createSources.
 * @param {object} frame - From sources.latestFrame().
 * @param {{ latitude: number, longitude: number }} place - The place.
 * @param {object} options - Options.
 * @param {number} options.zoom - Map zoom, 3 to 7.
 * @param {string} options.time - The frame time, as shown ("16:40").
 * @param {object} [options.logger] - Logger.
 * @returns {Promise<Buffer>} JPEG bytes.
 */
export async function renderPlace(sources, frame, place, { zoom, time, logger = console }) {
  const center = worldPixel(place.latitude, place.longitude, zoom);
  const left = Math.round(center.x - IMAGE_WIDTH / 2);
  const top = Math.round(center.y - IMAGE_HEIGHT / 2);
  const radarAt = await mosaic(
    (z, x, y) => sources.radarTile(frame, z, x, y),
    left,
    top,
    IMAGE_WIDTH,
    IMAGE_HEIGHT,
    zoom,
  );
  let mapAt = () => null;
  try {
    mapAt = await mosaic(
      (z, x, y) => sources.mapTile(z, x, y),
      left,
      top,
      IMAGE_WIDTH,
      IMAGE_HEIGHT,
      zoom,
    );
  } catch (err) {
    // The rain without its map still says something: grey background.
    logger.debug(`Map tiles unavailable: ${err.message}`);
  }

  const data = Buffer.alloc(IMAGE_WIDTH * IMAGE_HEIGHT * 4);
  for (let y = 0; y < IMAGE_HEIGHT; y += 1) {
    for (let x = 0; x < IMAGE_WIDTH; x += 1) {
      const i = (y * IMAGE_WIDTH + x) * 4;
      const map = mapAt(left + x, top + y);
      let r = NO_MAP_GREY;
      let g = NO_MAP_GREY;
      let b = NO_MAP_GREY;
      if (map) {
        r = map[0] + (255 - map[0]) * MAP_WASH;
        g = map[1] + (255 - map[1]) * MAP_WASH;
        b = map[2] + (255 - map[2]) * MAP_WASH;
      }
      const rain = radarAt(left + x, top + y);
      if (rain && rain[3] > 0) {
        const alpha = rain[3] / 255;
        r = r * (1 - alpha) + rain[0] * alpha;
        g = g * (1 - alpha) + rain[1] * alpha;
        b = b * (1 - alpha) + rain[2] * alpha;
      }
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  const bitmap = { data, width: IMAGE_WIDTH, height: IMAGE_HEIGHT };
  drawCross(bitmap, IMAGE_WIDTH / 2, IMAGE_HEIGHT / 2);
  drawLabel(bitmap, time, 6, 6);
  const credit = 'RainViewer | © OpenStreetMap';
  drawLabel(bitmap, credit, IMAGE_WIDTH - textWidth(credit) - 8, IMAGE_HEIGHT - GLYPH_HEIGHT - 8);
  return encodeCameraJpeg(bitmap);
}

function setPixel(bitmap, x, y, rgb) {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) {
    return;
  }
  const i = (y * bitmap.width + x) * 4;
  [bitmap.data[i], bitmap.data[i + 1], bitmap.data[i + 2]] = rgb;
}

// A red cross with a white outline, readable on the map and on the rain.
function drawCross(bitmap, cx, cy) {
  for (const [rgb, half, arm] of [
    [[255, 255, 255], 2, 9],
    [[220, 20, 60], 1, 8],
  ]) {
    for (let d = -arm; d <= arm; d += 1) {
      for (let w = -half + 1; w < half; w += 1) {
        setPixel(bitmap, cx + d, cy + w, rgb);
        setPixel(bitmap, cx + w, cy + d, rgb);
      }
    }
  }
}

// Dark text on a white box.
function drawLabel(bitmap, text, left, top) {
  for (let y = top - 2; y < top + GLYPH_HEIGHT + 2; y += 1) {
    for (let x = left - 3; x < left + textWidth(text) + 2; x += 1) {
      setPixel(bitmap, x, y, [255, 255, 255]);
    }
  }
  drawText(bitmap, text, left, top, [40, 40, 40]);
}
