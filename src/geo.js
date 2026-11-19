// -----------------------------------------------------------------------------
// Web Mercator arithmetic: the tiles of RainViewer and OpenStreetMap share the
// "slippy map" grid (zoom z: 2^z × 2^z tiles of 256 px).
// -----------------------------------------------------------------------------

export const TILE_SIZE = 256;
// Web Mercator stops at ±85.0511°: beyond, there is no tile.
export const MAX_LATITUDE = 85.0511;
const EARTH_RADIUS_KM = 6371.0088;

/**
 * The position of a point in world pixels at a zoom level.
 * @param {number} latitude - Degrees.
 * @param {number} longitude - Degrees.
 * @param {number} zoom - Zoom level.
 * @returns {{ x: number, y: number }} Fractional pixels from the top-left corner of the world.
 */
export function worldPixel(latitude, longitude, zoom) {
  const scale = TILE_SIZE * 2 ** zoom;
  const lat = Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, latitude));
  const sin = Math.sin((lat * Math.PI) / 180);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The ground size of one pixel at a latitude and zoom level.
 * @param {number} latitude - Degrees.
 * @param {number} zoom - Zoom level.
 * @returns {number} Kilometres per pixel.
 */
export function kmPerPixel(latitude, zoom) {
  return (
    (2 * Math.PI * EARTH_RADIUS_KM * Math.cos((latitude * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom)
  );
}

/**
 * The tiles covering a rectangle of world pixels, wrapped around the
 * antimeridian on x, clipped at the poles on y.
 * @param {number} left - World pixel.
 * @param {number} top - World pixel.
 * @param {number} width - Pixels.
 * @param {number} height - Pixels.
 * @param {number} zoom - Zoom level.
 * @returns {Array<{ x: number, y: number, tx: number, ty: number }>} `x`/`y`:
 * the tile in the grid; `tx`/`ty`: its unwrapped column and row.
 */
export function tilesFor(left, top, width, height, zoom) {
  const count = 2 ** zoom;
  const tiles = [];
  for (
    let ty = Math.floor(top / TILE_SIZE);
    ty <= Math.floor((top + height - 1) / TILE_SIZE);
    ty += 1
  ) {
    if (ty < 0 || ty >= count) {
      continue;
    }
    for (
      let tx = Math.floor(left / TILE_SIZE);
      tx <= Math.floor((left + width - 1) / TILE_SIZE);
      tx += 1
    ) {
      tiles.push({ x: ((tx % count) + count) % count, y: ty, tx, ty });
    }
  }
  return tiles;
}
