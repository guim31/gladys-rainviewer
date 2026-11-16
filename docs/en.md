# RainViewer

## What it does

The worldwide rain radar mosaic of [RainViewer](https://www.rainviewer.com) in Gladys, with no account and no API key. Each place becomes a device:

- **Rain radar**: a camera image of the radar centered on the place, over an OpenStreetMap map, renewed with every radar frame (every 10 minutes);
- **Rain**: whether rain falls on the place now (1 = rain);
- **Rain rate**: its approximate rate, in mm/h;
- **Nearest rain**: the distance to the nearest rain, in km (0 when it rains on the place, 50 when no rain falls within 50 km);
- **Radar time**: the time of the radar frame.

It complements the national radar integrations (Buienradar for the Netherlands and Belgium, DWD for Germany) with one worldwide source.

## Requirements

- Gladys Assistant 5.1.0 or later.
- An Internet connection: the radar comes from the RainViewer servers.
- At least one place: a house of Gladys with a location (Settings → Houses), or an "Other place" of the configuration.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and enter `https://github.com/guim31/gladys-rainviewer`.
2. Accept the access to the location of your houses: it gives each house its radar.
3. Open the **Discovery** tab and add the places you want.

## Configuration

- **Language of the feature names**: English, French, German or Spanish (French by default). Used when a device is added, and for the radar time.
- **Radar image extent**: Region (about 500 km, default), Country (about 1,000 km) or Continent (about 2,000 km). The rain values are always read at the finest scale.
- **“Rain approaching” distance (km)**: from 2 to 50 km, 15 by default.
- **Other places**: optional, `Name: latitude, longitude` separated by semicolons, e.g. `Office: 48.8566, 2.3522; Chalet: 45.92, 6.87`. Renaming a place creates a new device. Eight places at most, houses included.

The **Check the radar** button reads the newest radar image now and says, for each place, whether it rains.

## Devices

The values are read from the newest radar frame, at the finest scale of the public API (about 1 km per pixel in Europe):

- rain falls on the place when the radar sees at least 15 dBZ within about 1 km of it (below, the faint echoes are drizzle at most, often ground clutter);
- the rate is derived from the reflectivity with the Marshall-Palmer relation: an approximation, often off by a factor of two, enough to tell drizzle from a downpour;
- the nearest rain is looked for within 50 km.

Outside the radar coverage (oceans, most of Africa and Asia), the device shows the radar time only, and the integration says so in its log.

## Dashboard widget

**Rain radar**: the radar image of a place, the rain there and the nearest rain, with the time of the radar frame. The **Show the radar image** setting hides the image, for a small tile. The camera of each place also works in the Gladys camera box, and with the "Send a camera image" scene action.

## Scenes

Triggers:

- **RainViewer: rain approaching**: rain comes within the configured distance of a place where it does not rain yet. Fires once per approach, never at start-up. Variables: place, distance (km).
- **RainViewer: rain stopped**: the radar has shown no more rain over a place for 20 minutes, after a rain episode. Variables: place, rain duration (min).

Leave the place empty for every place. Rain that starts is the **Rain** feature going to 1, a regular device condition.

Action:

- **RainViewer: read the rain**: reads the newest radar image for a place: raining, rain rate (mm/h), nearest rain (km), radar time, for a condition or a message. It fails (in red) outside the radar coverage.

## Limits

- RainViewer's public API serves the past two hours of radar only: no forecast (nowcast) frames, so the integration watches the distance of the rain rather than predicting it.
- Zoom 7 at most and one color scheme (Universal Blue), as the public API allows.
- A radar sees rain, not always snow; a few echoes are not rain (ground clutter, wind farms).
- RainViewer gives no guarantee of availability: when it does not answer for 30 minutes, the integration shows it in Gladys and resumes on its own.

## How it was tested

Tested against the real RainViewer API: places under the rain, dry, near rain and outside the radar coverage, a network outage, and the radar images checked by eye. The tests replay real radar tiles. Not yet tested in a real Gladys: feedback welcome on [GitHub](https://github.com/guim31/gladys-rainviewer/issues).

## Credits and terms

Radar data by [RainViewer](https://www.rainviewer.com), whose free API is for personal and educational use; the credit "RainViewer" is written on every image and in the widget. Map © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors; the map tiles are cached 30 days, as the OSM tile policy asks. This integration is not affiliated with RainViewer.

## Support

Questions and bugs: [GitHub issues](https://github.com/guim31/gladys-rainviewer/issues).
