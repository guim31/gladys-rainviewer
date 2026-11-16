// -----------------------------------------------------------------------------
// What a place becomes in Gladys: one device, with
//   - `image`: the radar picture centered on the place (`camera/image`);
//   - `rain`: rain falls on the place now (`rain-sensor/binary`, 1 = rain);
//   - `rate`: its approximate rate (`precipitation-sensor/decimal`, mm/h);
//   - `distance`: the nearest rain (`distance-sensor/decimal`, km; 0 when it
//     rains on the place, WATCH_RADIUS_KM when none falls closer);
//   - `radar_time`: the time of the radar frame (`text/text`).
//
// A place is a house of Gladys (its id) or an "Other place" of the config
// (its name). Feature keys are forever: they are part of the external ids.
// -----------------------------------------------------------------------------

import { WATCH_RADIUS_KM } from './radar.js';

export const DEVICE_TYPE = 'place';
export const FEATURE_KEYS = {
  IMAGE: 'image',
  RAIN: 'rain',
  RATE: 'rate',
  DISTANCE: 'distance',
  RADAR_TIME: 'radar_time',
};
// Above any rain a radar measures (Marshall-Palmer at 65 dBZ: 205 mm/h).
export const MAX_RATE = 250;

// Feature names, frozen when the user adds the device.
export const NAMES = {
  en: {
    image: 'Rain radar',
    rain: 'Rain',
    rate: 'Rain rate',
    distance: 'Nearest rain',
    radar_time: 'Radar time',
  },
  fr: {
    image: 'Radar de pluie',
    rain: 'Pluie',
    rate: 'Intensité de pluie',
    distance: 'Pluie la plus proche',
    radar_time: 'Heure du radar',
  },
  de: {
    image: 'Regenradar',
    rain: 'Regen',
    rate: 'Regenintensität',
    distance: 'Nächster Regen',
    radar_time: 'Radarzeit',
  },
  es: {
    image: 'Radar de lluvia',
    rain: 'Lluvia',
    rate: 'Intensidad de lluvia',
    distance: 'Lluvia más cercana',
    radar_time: 'Hora del radar',
  },
};

export const namesFor = (language) => NAMES[language] ?? NAMES.en;

/** A place name as an identifier: lower case, `[a-z0-9-]`. */
export function slugOf(name) {
  return (
    String(name)
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'place'
  );
}

/** The platform id of a place: `house-<house id>` or `place-<name slug>`. */
export function placeId(place) {
  return place.houseId ? `house-${place.houseId}` : `place-${slugOf(place.name)}`;
}

export function deviceIds(gladys, place) {
  return gladys.externalIds(DEVICE_TYPE, placeId(place));
}

const feature = (key, name, spec) => ({
  key,
  name,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...spec,
});

export function buildDevice(gladys, place, language) {
  const ids = deviceIds(gladys, place);
  const names = namesFor(language);
  const features = [
    feature(FEATURE_KEYS.IMAGE, names.image, {
      category: 'camera',
      type: 'image',
      min: 0,
      max: 0,
      keep_history: false,
    }),
    feature(FEATURE_KEYS.RAIN, names.rain, {
      category: 'rain-sensor',
      type: 'binary',
      min: 0,
      max: 1,
    }),
    feature(FEATURE_KEYS.RATE, names.rate, {
      category: 'precipitation-sensor',
      type: 'decimal',
      unit: 'millimeter-per-hour',
      min: 0,
      max: MAX_RATE,
    }),
    feature(FEATURE_KEYS.DISTANCE, names.distance, {
      category: 'distance-sensor',
      type: 'decimal',
      unit: 'km',
      min: 0,
      max: WATCH_RADIUS_KM,
    }),
    feature(FEATURE_KEYS.RADAR_TIME, names.radar_time, {
      category: 'text',
      type: 'text',
      min: 0,
      max: 0,
      keep_history: false,
    }),
  ];
  return {
    name: place.name,
    external_id: ids.device,
    model: 'RainViewer',
    // The integration pushes a new frame every 10 minutes itself.
    should_poll: false,
    features: features.map(({ key, ...spec }) => ({ ...spec, external_id: ids.feature(key) })),
  };
}

/**
 * The states of a place after an analysis (outside radar coverage: the time
 * only, the rain is unknown there).
 * @returns {Array<object>} publishChangedStates entries.
 */
export function buildStates(gladys, place, reading, timeText) {
  const ids = deviceIds(gladys, place);
  const states = [
    { device_feature_external_id: ids.feature(FEATURE_KEYS.RADAR_TIME), text: timeText },
  ];
  if (reading.covered) {
    states.push(
      {
        device_feature_external_id: ids.feature(FEATURE_KEYS.RAIN),
        state: reading.raining ? 1 : 0,
      },
      { device_feature_external_id: ids.feature(FEATURE_KEYS.RATE), state: reading.rate },
      {
        device_feature_external_id: ids.feature(FEATURE_KEYS.DISTANCE),
        state: reading.distanceKm ?? WATCH_RADIUS_KM,
      },
    );
  }
  return states;
}
