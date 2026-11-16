// -----------------------------------------------------------------------------
// Integration configuration: defaults (mirroring the manifest) and
// normalization, so the rest of the code never deals with a raw form value.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];
export const ZOOMS = ['5', '6', '7'];
export const APPROACH_MIN_KM = 2;
export const APPROACH_MAX_KM = 50;
// Places, the houses of Gladys included: each one costs a few tiles per frame.
export const MAX_PLACES = 8;

export const DEFAULT_CONFIG = {
  language: 'fr',
  zoom: '7',
  approach_km: 15,
  extra_places: '',
};

const NUMBER = '-?\\d{1,3}(?:[.,]\\d+)?';
const COORDINATES = new RegExp(`^(${NUMBER})\\s*(?:,\\s*|\\s+)(${NUMBER})$`);
const toNumber = (text) => Number(text.replace(',', '.'));

/**
 * Parse the "Other places" field: `Name: latitude, longitude`, one place per
 * `;` or line. Decimal commas are accepted ("Chalet: 45,92 6,87").
 * @param {string} text - The field.
 * @returns {{ places: Array<{ name: string, latitude: number, longitude: number }>, errors: string[] }}
 * The places, and the entries that could not be read.
 */
export function parsePlaces(text) {
  const places = [];
  const errors = [];
  for (const entry of String(text ?? '').split(/[;\n]/)) {
    const trimmed = entry.trim();
    if (trimmed === '') {
      continue;
    }
    const colon = trimmed.lastIndexOf(':');
    const name = trimmed.slice(0, colon).trim().slice(0, 60);
    const match = COORDINATES.exec(trimmed.slice(colon + 1).trim());
    const latitude = match ? toNumber(match[1]) : NaN;
    const longitude = match ? toNumber(match[2]) : NaN;
    if (
      colon < 1 ||
      name === '' ||
      !(Math.abs(latitude) <= 85) ||
      !(Math.abs(longitude) <= 180) ||
      places.some((place) => place.name.toLowerCase() === name.toLowerCase())
    ) {
      errors.push(trimmed.slice(0, 60));
      continue;
    }
    places.push({ name, latitude, longitude });
  }
  return { places, errors };
}

/**
 * Merge the user config with the defaults.
 * @param {object} [raw] - The config from Gladys.
 * @returns {object} The normalized config.
 */
export function normalizeConfig(raw = {}) {
  const language = LANGUAGES.includes(raw.language) ? raw.language : DEFAULT_CONFIG.language;
  const zoom = ZOOMS.includes(String(raw.zoom)) ? String(raw.zoom) : DEFAULT_CONFIG.zoom;
  const approach = Math.round(Number(raw.approach_km ?? DEFAULT_CONFIG.approach_km));
  return {
    language,
    zoom,
    approach_km: Number.isFinite(approach)
      ? Math.min(APPROACH_MAX_KM, Math.max(APPROACH_MIN_KM, approach))
      : DEFAULT_CONFIG.approach_km,
    extra_places: typeof raw.extra_places === 'string' ? raw.extra_places : '',
  };
}
