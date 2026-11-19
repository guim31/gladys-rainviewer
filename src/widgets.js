// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `rain_radar`.
//
// One place at a glance: the radar picture, whether it rains there and how
// much, how far the nearest rain is, and the time of the radar frame with the
// RainViewer credit. The picture can be hidden (a setting), for a small tile.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { placeId } from './devices.js';
import { WATCH_RADIUS_KM } from './radar.js';
import { t, timeOf } from './texts.js';

export const WIDGET_KEY = 'rain_radar';

export const TEXT = {
  pick: {
    en: 'Choose a place in the settings of this widget.',
    fr: 'Choisissez un lieu dans les réglages de ce widget.',
    de: 'Wähle in den Einstellungen dieses Widgets einen Ort aus.',
    es: 'Elija un lugar en la configuración de este widget.',
  },
  unavailable: {
    en: 'No radar image for this place yet: RainViewer does not answer, or the place is no longer watched.',
    fr: 'Pas encore d’image radar pour ce lieu : RainViewer ne répond pas, ou le lieu n’est plus surveillé.',
    de: 'Noch kein Radarbild für diesen Ort: RainViewer antwortet nicht, oder der Ort wird nicht mehr beobachtet.',
    es: 'Aún no hay imagen de radar para este lugar: RainViewer no responde, o el lugar ya no se vigila.',
  },
  radar: { en: 'Radar', fr: 'Radar', de: 'Radar', es: 'Radar' },
  rain: { en: 'Rain', fr: 'Pluie', de: 'Regen', es: 'Lluvia' },
  nearest: {
    en: 'Nearest rain',
    fr: 'Pluie la plus proche',
    de: 'Nächster Regen',
    es: 'Lluvia más cercana',
  },
  coverage: { en: 'Radar', fr: 'Radar', de: 'Radar', es: 'Radar' },
  outside: {
    en: 'Outside coverage',
    fr: 'Hors couverture',
    de: 'Keine Abdeckung',
    es: 'Sin cobertura',
  },
  no: { en: 'No', fr: 'Non', de: 'Nein', es: 'No' },
  none: {
    en: `None within ${WATCH_RADIUS_KM} km`,
    fr: `Aucune à ${WATCH_RADIUS_KM} km`,
    de: `Keiner im Umkreis ${WATCH_RADIUS_KM} km`,
    es: `Ninguna a ${WATCH_RADIUS_KM} km`,
  },
};

const tagOf = (place) => createHash('sha1').update(placeId(place)).digest('hex').slice(0, 12);

// When the bytes change, the key changes: the frame time is part of it.
export const imageKey = (place, entry) => `radar-${tagOf(place)}-${entry.imageTime.toString(36)}`;

const message = (text, language) => ({
  ttl_seconds: 60,
  components: [{ type: 'text', variant: 'body', text: t(text, language) }],
});

async function get(app, { settings, language = 'en' }) {
  if (!settings?.place) {
    return message(TEXT.pick, language);
  }
  let found;
  try {
    found = await app.readingOf(settings.place);
  } catch {
    return message(TEXT.unavailable, language);
  }
  const { place, entry } = found;
  const { reading } = entry;
  const components = [
    {
      type: 'text',
      variant: 'caption',
      text: `${t(TEXT.radar, language)} ${timeOf(entry.frameTime, language)} · RainViewer`,
    },
  ];
  if (settings.show_image !== false && entry.image) {
    components.push({
      type: 'image',
      key: imageKey(place, entry),
      alt: app.deviceName(place).slice(0, 100),
      fit: 'contain',
    });
  }
  const items = [];
  if (!reading.covered) {
    items.push({
      label: t(TEXT.coverage, language),
      icon: 'cloud-off',
      value: t(TEXT.outside, language),
      color: WIDGET_COLORS.WARNING,
    });
  } else {
    items.push({
      label: t(TEXT.rain, language),
      icon: 'cloud-rain',
      value: reading.raining ? `${reading.rate} mm/h` : t(TEXT.no, language),
      color: reading.raining ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
    items.push({
      label: t(TEXT.nearest, language),
      icon: 'navigation',
      value: reading.distanceKm === null ? t(TEXT.none, language) : `${reading.distanceKm} km`,
      color:
        reading.distanceKm !== null && reading.distanceKm <= app.config.approach_km
          ? WIDGET_COLORS.WARNING
          : WIDGET_COLORS.NEUTRAL,
    });
  }
  components.push({ type: 'status', items });
  return { ttl_seconds: 300, components };
}

/** The bytes behind an image key (raw base64 JPEG). */
export async function widgetImage(app, key) {
  const match = /^radar-([0-9a-f]{12})-[0-9a-z]+$/.exec(String(key));
  const place = match ? app.places.find((item) => tagOf(item) === match[1]) : null;
  const entry = place ? app.watched.get(placeId(place)) : null;
  if (!entry?.image) {
    throw new Error(`Unknown image ${key}`);
  }
  // 150 KB at most (the camera limit), under the 300 KB of a widget image.
  return entry.image.toString('base64');
}

export const WIDGETS = {
  [WIDGET_KEY]: { get },
};
