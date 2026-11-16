// -----------------------------------------------------------------------------
// The texts the container produces, in the four languages of Gladys. German
// says "du", Spanish "usted".
// -----------------------------------------------------------------------------

/**
 * A failure shown in red under a button or in a scene: Gladys shows the
 * message of a thrown error, here the multi-language object.
 */
export class ActionFailure extends Error {
  constructor(text) {
    super(text.en);
    this.message = text;
  }
}

export const t = (text, language) => text[language] ?? text.en;

export const CONNECTION_TEXT = {
  unreachable: {
    en: 'RainViewer does not answer: the radar is not updated.',
    fr: 'RainViewer ne répond pas : le radar n’est plus mis à jour.',
    de: 'RainViewer antwortet nicht: Das Radar wird nicht aktualisiert.',
    es: 'RainViewer no responde: el radar no se actualiza.',
  },
};

export const FAILURE = {
  unreachable: CONNECTION_TEXT.unreachable,
  noPlace: {
    en: 'No place to watch: give your house a location in Gladys, or add a place in the configuration.',
    fr: 'Aucun lieu à surveiller : situez votre maison dans Gladys, ou ajoutez un lieu dans la configuration.',
    de: 'Kein Ort zu beobachten: Gib deinem Haus in Gladys einen Standort oder füge einen Ort in der Konfiguration hinzu.',
    es: 'Ningún lugar que vigilar: sitúe su casa en Gladys o añada un lugar en la configuración.',
  },
  pick: {
    en: 'Choose a place.',
    fr: 'Choisissez un lieu.',
    de: 'Wähle einen Ort.',
    es: 'Elija un lugar.',
  },
  unknownPlace: {
    en: 'This place is no longer watched: its house has no location, or it left the configuration.',
    fr: 'Ce lieu n’est plus surveillé : sa maison n’est plus située, ou il a quitté la configuration.',
    de: 'Dieser Ort wird nicht mehr beobachtet: Sein Haus hat keinen Standort mehr, oder er ist nicht mehr in der Konfiguration.',
    es: 'Este lugar ya no se vigila: su casa ya no tiene ubicación, o ya no está en la configuración.',
  },
  outside: {
    en: 'This place is outside the radar coverage of RainViewer.',
    fr: 'Ce lieu est hors de la couverture radar de RainViewer.',
    de: 'Dieser Ort liegt außerhalb der Radarabdeckung von RainViewer.',
    es: 'Este lugar está fuera de la cobertura radar de RainViewer.',
  },
};

// The "Check the radar" report, one language at a time.
export const CHECK_TEXT = {
  en: {
    head: (time) => `RainViewer answers: radar image of ${time}.`,
    raining: (rate) => `rain, about ${rate} mm/h`,
    near: (km) => `dry, nearest rain ${km} km`,
    dry: (km) => `dry within ${km} km`,
    outside: 'outside radar coverage',
    pending: 'not read yet: add the device in Gladys',
    invalid: (entries) => `Other places not understood: ${entries}.`,
  },
  fr: {
    head: (time) => `RainViewer répond : image radar de ${time}.`,
    raining: (rate) => `pluie, environ ${rate} mm/h`,
    near: (km) => `sec, pluie la plus proche à ${km} km`,
    dry: (km) => `sec à ${km} km à la ronde`,
    outside: 'hors couverture radar',
    pending: 'pas encore lu : ajoutez l’appareil dans Gladys',
    invalid: (entries) => `Autres lieux non compris : ${entries}.`,
  },
  de: {
    head: (time) => `RainViewer antwortet: Radarbild von ${time}.`,
    raining: (rate) => `Regen, etwa ${rate} mm/h`,
    near: (km) => `trocken, nächster Regen ${km} km`,
    dry: (km) => `trocken im Umkreis von ${km} km`,
    outside: 'außerhalb der Radarabdeckung',
    pending: 'noch nicht gelesen: Füge das Gerät in Gladys hinzu',
    invalid: (entries) => `Nicht verstandene weitere Orte: ${entries}.`,
  },
  es: {
    head: (time) => `RainViewer responde: imagen de radar de las ${time}.`,
    raining: (rate) => `lluvia, unos ${rate} mm/h`,
    near: (km) => `seco, lluvia más cercana a ${km} km`,
    dry: (km) => `seco en ${km} km a la redonda`,
    outside: 'fuera de la cobertura radar',
    pending: 'aún no leído: añada el dispositivo en Gladys',
    invalid: (entries) => `Otros lugares no entendidos: ${entries}.`,
  },
};

/** The time of a frame, in the time zone of Gladys (TZ). */
export function timeOf(ms, language) {
  return new Intl.DateTimeFormat(language, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(ms),
  );
}
