// -----------------------------------------------------------------------------
// From a radar pixel to a rain rate.
//
// The public API serves one color scheme only, "Universal Blue" (id 2). Its
// table (https://www.rainviewer.com/files/rainviewer_api_colors_table.csv,
// column "Universal Blue", rain rows) maps every reflectivity from -10 to
// 95 dBZ to one RGBA color; the scheme saturates at 65 dBZ (white) and 75 dBZ
// (green), kept here once each. Tiles are asked unsmoothed and without the
// snow colors (options `0_0`), so every pixel is one of these colors.
// -----------------------------------------------------------------------------

// [dBZ, 0xRRGGBBAA], Universal Blue, rain.
const UNIVERSAL_BLUE = [
  [-10, 0x63615914],
  [-9, 0x66635a19],
  [-8, 0x69665c1e],
  [-7, 0x6c685d24],
  [-6, 0x6f6b5f29],
  [-5, 0x726e612e],
  [-4, 0x75706234],
  [-3, 0x78736439],
  [-2, 0x7c75653e],
  [-1, 0x7f786744],
  [0, 0x827b6949],
  [1, 0x857d6a4e],
  [2, 0x88806c54],
  [3, 0x8b826d59],
  [4, 0x8e856f5e],
  [5, 0x92887164],
  [6, 0x9e93756e],
  [7, 0xaa9e7978],
  [8, 0xb6a97e82],
  [9, 0xc2b4828c],
  [10, 0xcec08796],
  [11, 0xd2c48ba0],
  [12, 0xd6c88faa],
  [13, 0xdacc93b4],
  [14, 0xded097be],
  [15, 0x88ddeeff],
  [16, 0x6cd1ebff],
  [17, 0x51c5e8ff],
  [18, 0x36bae5ff],
  [19, 0x1baee2ff],
  [20, 0x00a3e0ff],
  [21, 0x009ad5ff],
  [22, 0x0091caff],
  [23, 0x0088bfff],
  [24, 0x007fb4ff],
  [25, 0x0077aaff],
  [26, 0x0070a3ff],
  [27, 0x00699cff],
  [28, 0x006295ff],
  [29, 0x005b8eff],
  [30, 0x005588ff],
  [31, 0x005180ff],
  [32, 0x004e78ff],
  [33, 0x004a70ff],
  [34, 0x004768ff],
  [35, 0xffee00ff],
  [36, 0xffe000ff],
  [37, 0xffd200ff],
  [38, 0xffc500ff],
  [39, 0xffb700ff],
  [40, 0xffaa00ff],
  [41, 0xff9f00ff],
  [42, 0xff9500ff],
  [43, 0xff8b00ff],
  [44, 0xff8100ff],
  [45, 0xff4400ff],
  [46, 0xf23600ff],
  [47, 0xe62800ff],
  [48, 0xd91b00ff],
  [49, 0xcd0d00ff],
  [50, 0xc10000ff],
  [51, 0xa80000ff],
  [52, 0x8f0000ff],
  [53, 0x760000ff],
  [54, 0x5d0000ff],
  [55, 0xffaaffff],
  [56, 0xff9fffff],
  [57, 0xff95ffff],
  [58, 0xff8bffff],
  [59, 0xff81ffff],
  [60, 0xff77ffff],
  [61, 0xff6cffff],
  [62, 0xff62ffff],
  [63, 0xff58ffff],
  [64, 0xff4effff],
  [65, 0xffffffff],
  [75, 0x00ff00ff],
];

const EXACT = new Map(UNIVERSAL_BLUE.map(([dbz, rgba]) => [rgba >>> 0, dbz]));

// Below this reflectivity the scheme draws a faint grey haze: drizzle at
// most, often ground clutter. RainViewer itself starts its rain colors here.
export const RAIN_THRESHOLD_DBZ = 15;
// Beyond this distance a pixel is no palette color (a resampled edge).
const MAX_COLOR_DISTANCE = 24 * 24 * 3;

/**
 * The reflectivity a radar pixel stands for.
 * @param {number} r - Red, 0-255.
 * @param {number} g - Green.
 * @param {number} b - Blue.
 * @param {number} a - Alpha.
 * @returns {number|null} dBZ, or null for "no echo" (transparent or unknown color).
 */
export function pixelDbz(r, g, b, a) {
  if (a === 0) {
    return null;
  }
  const exact = EXACT.get(((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
  if (exact !== undefined) {
    return exact;
  }
  // Not exact (a smoothed or recompressed tile): the nearest opaque color.
  let best = null;
  let bestDistance = Infinity;
  for (const [dbz, rgba] of UNIVERSAL_BLUE) {
    const dr = ((rgba >>> 24) & 0xff) - r;
    const dg = ((rgba >>> 16) & 0xff) - g;
    const db = ((rgba >>> 8) & 0xff) - b;
    const da = (rgba & 0xff) - a;
    const distance = dr * dr + dg * dg + db * db + da * da;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = dbz;
    }
  }
  return bestDistance <= MAX_COLOR_DISTANCE ? best : null;
}

/**
 * Rain rate from reflectivity, Marshall-Palmer (Z = 200 R^1.6): an
 * approximation, the usual one for stratiform rain.
 * @param {number|null} dbz - Reflectivity.
 * @returns {number} mm/h, one decimal; 0 below the rain threshold.
 */
export function rainRate(dbz) {
  if (dbz === null || dbz < RAIN_THRESHOLD_DBZ) {
    return 0;
  }
  const rate = (10 ** (dbz / 10) / 200) ** (1 / 1.6);
  return Math.round(rate * 10) / 10;
}

export { UNIVERSAL_BLUE };
