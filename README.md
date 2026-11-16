# RainViewer for Gladys Assistant

The worldwide rain radar of [RainViewer](https://www.rainviewer.com) in
[Gladys Assistant](https://gladysassistant.com), free and without account.

Each place (your houses located in Gladys, and other places you add) becomes a
device with:

- **a radar camera image** centered on the place, over an OpenStreetMap map,
  renewed with every radar frame (every 10 minutes);
- **rain now** (yes/no) and its **approximate rate** (mm/h);
- **the distance to the nearest rain** (km, within 50 km);
- **the time of the radar frame**.

On top of the devices: the scene triggers **Rain approaching** and **Rain
stopped**, the scene action **Read the rain**, a **Rain radar** dashboard
widget, and a **Check the radar** button. Texts in English, French, German and
Spanish.

It complements the national radar integrations of the store (Buienradar for
the Netherlands and Belgium, DWD for Germany) with one worldwide source.

## Requirements

- Gladys Assistant 5.1.0 or later.
- An Internet connection.
- A house of Gladys with a location, or an "Other place" in the configuration.

## Installation

In Gladys, open **Integrations → Install from GitHub** and enter
`https://github.com/guim31/gladys-rainviewer`. Accept the access to the location
of your houses, then add the places in the **Discovery** tab.

The full user documentation is in [docs/en.md](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

Every 5 minutes the integration asks RainViewer for its newest radar frame.
On a new frame, for each place added in Gladys, it reads the radar tiles at
zoom 7 (about 1 km per pixel in Europe): rain falls when the radar sees at
least 15 dBZ within about 1 km of the place; the rate comes from the
reflectivity by the Marshall-Palmer relation (an approximation); the nearest
rain is looked for within 50 km. It then draws the radar over the map and
pushes the image to the camera.

## Limits

- RainViewer's free public API serves the past two hours only: no nowcast
  frames, so "Rain approaching" watches the distance of the rain rather than
  forecasting it.
- Zoom 7 at most, one color scheme (Universal Blue).
- Outside the radar coverage (oceans, most of Africa and Asia), only the radar
  time is shown.
- A radar sees rain, not always snow, and some echoes are not rain.
- Tested against the real RainViewer API, not yet in a real Gladys: feedback
  welcome in the [issues](https://github.com/guim31/gladys-rainviewer/issues).

## Terms and credits

- Radar data by [RainViewer](https://www.rainviewer.com). Their free API is
  for personal and educational use, and asks for the credit "RainViewer",
  written on every image and in the widget. The integration caches what it can
  (the tiles of a frame are fetched once for all places, the coverage mask
  once a day).
- Map © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors,
  under the [OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/):
  the requests identify the integration, and the tiles are cached 30 days.
- The rain color table is RainViewer's
  [official table](https://www.rainviewer.com/files/rainviewer_api_colors_table.csv).
- Built from the official
  [JavaScript template](https://github.com/GladysAssistant/integration-template-js)
  and SDK of Gladys Assistant; uses [pngjs](https://github.com/pngjs/pngjs) (MIT)
  and [jpeg-js](https://github.com/jpeg-js/jpeg-js) (BSD-3-Clause).

This integration is not affiliated with RainViewer nor with the OpenStreetMap
Foundation.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

See [CLAUDE.md](CLAUDE.md) for the project rules and the API details.

## License

Apache-2.0, see [LICENSE](LICENSE).
