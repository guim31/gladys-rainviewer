# RainViewer

## Was die Integration macht

Das weltweite Regenradar-Mosaik von [RainViewer](https://www.rainviewer.com) in Gladys, ohne Konto und ohne API-Schlüssel. Jeder Ort wird ein Gerät:

- **Regenradar**: ein Kamerabild des Radars, auf den Ort zentriert, über einer OpenStreetMap-Karte, mit jedem Radarbild erneuert (alle 10 Minuten);
- **Regen**: ob es gerade am Ort regnet (1 = Regen);
- **Regenintensität**: seine ungefähre Intensität in mm/h;
- **Nächster Regen**: die Entfernung zum nächsten Regen in km (0, wenn es am Ort regnet, 50, wenn im Umkreis von 50 km kein Regen fällt);
- **Radarzeit**: die Uhrzeit des Radarbilds.

Die Integration ergänzt die nationalen Radar-Integrationen (Buienradar für die Niederlande und Belgien, DWD für Deutschland) um eine weltweite Quelle.

## Voraussetzungen

- Gladys Assistant 5.1.0 oder neuer.
- Eine Internetverbindung: Das Radar kommt von den Servern von RainViewer.
- Mindestens ein Ort: ein Haus in Gladys mit Standort (Einstellungen → Häuser) oder ein „Weiterer Ort“ in der Konfiguration.

## Installation

1. Öffne in Gladys **Integrationen → Von GitHub installieren** und gib `https://github.com/guim31/gladys-rainviewer` ein.
2. Erlaube den Zugriff auf den Standort deiner Häuser: So bekommt jedes Haus sein Radar.
3. Öffne den Tab **Entdecken** und füge die gewünschten Orte hinzu.

## Konfiguration

- **Sprache der Funktionsnamen**: Englisch, Französisch, Deutsch oder Spanisch (standardmäßig Französisch). Wird beim Hinzufügen eines Geräts und für die Radarzeit verwendet.
- **Ausschnitt des Radarbilds**: Region (etwa 500 km, Standard), Land (etwa 1.000 km) oder Kontinent (etwa 2.000 km). Die Regenwerte werden immer im feinsten Maßstab gelesen.
- **Entfernung „Regen im Anmarsch“ (km)**: von 2 bis 50 km, standardmäßig 15.
- **Weitere Orte**: optional, `Name: Breitengrad, Längengrad` durch Semikolons getrennt, zum Beispiel `Büro: 48.8566, 2.3522; Hütte: 45.92, 6.87`. Ein umbenannter Ort wird ein neues Gerät. Höchstens acht Orte, Häuser inbegriffen.

Die Schaltfläche **Radar prüfen** liest jetzt das neueste Radarbild und sagt für jeden Ort, ob es regnet.

## Geräte

Die Werte werden aus dem neuesten Radarbild gelesen, im feinsten Maßstab der öffentlichen API (in Europa etwa 1 km pro Pixel):

- Es regnet am Ort, wenn das Radar im Umkreis von etwa 1 km mindestens 15 dBZ sieht (darunter sind die schwachen Echos höchstens Niesel, oft Bodenechos);
- die Intensität wird mit der Marshall-Palmer-Beziehung aus der Reflektivität abgeleitet: eine Näherung, oft um den Faktor zwei daneben, genug, um Niesel von einem Platzregen zu unterscheiden;
- der nächste Regen wird im Umkreis von 50 km gesucht.

Außerhalb der Radarabdeckung (Ozeane, große Teile Afrikas und Asiens) zeigt das Gerät nur die Radarzeit, und die Integration vermerkt es in ihrem Protokoll.

## Dashboard-Widget

**Regenradar**: das Radarbild eines Ortes, der Regen dort und der nächste Regen, mit der Uhrzeit des Radarbilds. Die Einstellung **Radarbild anzeigen** blendet das Bild aus, für eine kleine Kachel. Die Kamera jedes Ortes funktioniert auch in der Kamera-Box von Gladys und mit der Szenenaktion „Kamerabild senden“.

## Szenen

Auslöser:

- **RainViewer: Regen im Anmarsch**: Regen auf dem Radar kommt einem Ort, an dem es noch nicht regnet, bis auf die eingestellte Entfernung nahe. Einmal pro Annäherung (auch wenn ein Schauer zwischen zwei Radarbildern direkt am Ort beginnt, mit 0 km), nie beim Start. Variablen: Ort, Entfernung (km).
- **RainViewer: Regen vorbei**: Das Radar zeigt nach einem Regenschauer seit 20 Minuten keinen Regen mehr über einem Ort. Variablen: Ort, Regendauer (min).

Lass den Ort leer für alle Orte. Beginnender Regen ist die Funktion **Regen**, die auf 1 geht, eine normale Gerätebedingung.

Aktion:

- **RainViewer: Regen abfragen**: Liest das neueste Radarbild eines Ortes: es regnet, Intensität (mm/h), nächster Regen (km), Radarzeit, für eine Bedingung oder eine Nachricht. Außerhalb der Radarabdeckung schlägt sie fehl (rot).

## Grenzen

- Die öffentliche API von RainViewer liefert nur die letzten zwei Stunden Radar: keine Vorhersagebilder (Nowcast), daher beobachtet die Integration die Entfernung des Regens, statt ihn vorherzusagen.
- Höchstens Zoom 7 und ein einziges Farbschema (Universal Blue), wie es die öffentliche API erlaubt.
- Ein Radar sieht Regen, nicht immer Schnee; einige Echos sind kein Regen (Bodenechos, Windparks).
- RainViewer garantiert keine Verfügbarkeit: Antwortet es 30 Minuten lang nicht, zeigt die Integration das in Gladys an und macht danach selbst weiter.

## Wie sie getestet wurde

Gegen die echte API von RainViewer getestet: Orte im Regen, im Trockenen, nahe am Regen und außerhalb der Radarabdeckung, ein Netzausfall, und die Radarbilder mit eigenen Augen geprüft. Die Tests spielen echte Radarkacheln ab. Noch nicht in einem echten Gladys getestet: Rückmeldungen sind auf [GitHub](https://github.com/guim31/gladys-rainviewer/issues) willkommen.

## Danksagungen und Bedingungen

Radardaten von [RainViewer](https://www.rainviewer.com), dessen kostenlose API für den persönlichen und schulischen Gebrauch gedacht ist; der Hinweis „RainViewer“ steht auf jedem Bild und im Widget. Karte © [OpenStreetMap](https://www.openstreetmap.org/copyright)-Mitwirkende; die Kartenkacheln werden 30 Tage zwischengespeichert, wie es die Kachel-Richtlinie von OSM verlangt. Diese Integration ist nicht mit RainViewer verbunden.

## Hilfe

Fragen und Fehler: [GitHub-Issues](https://github.com/guim31/gladys-rainviewer/issues).
