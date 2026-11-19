// -----------------------------------------------------------------------------
// Scene action (manifest `scene_actions`, Gladys 5.1+): `get_rain`.
//
// What it adds to the device states: the whole radar reading of a place in
// one step, for a condition or a message ("Rain in {{0.0.distance_km}} km"),
// read from the newest frame. Outside the radar coverage it fails (red in
// the scene log) rather than saying "dry".
// -----------------------------------------------------------------------------

import { WATCH_RADIUS_KM } from './radar.js';
import { ActionFailure, FAILURE, timeOf } from './texts.js';

async function getRain(app, { fields }) {
  const { entry } = await app.readingOf(fields?.place);
  const { reading } = entry;
  if (!reading.covered) {
    throw new ActionFailure(FAILURE.outside);
  }
  return {
    raining: reading.raining,
    rate: reading.rate,
    distance_km: reading.distanceKm ?? WATCH_RADIUS_KM,
    radar_time: timeOf(entry.frameTime, app.config.language),
  };
}

export const SCENE_ACTIONS = { get_rain: getRain };
