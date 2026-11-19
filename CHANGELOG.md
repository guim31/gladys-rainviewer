# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-19

### Added

- One device per place (the houses of Gladys with a location, and other
  places in the configuration), from the worldwide rain radar of RainViewer,
  free and without account: a radar camera image centered on the place over an
  OpenStreetMap map, renewed every 10 minutes; rain now (yes/no); its
  approximate rate (mm/h); the distance to the nearest rain (km); the time of
  the radar frame.
- Scene triggers "Rain approaching" (rain within a chosen distance of a dry
  place) and "Rain stopped" (no rain for 20 minutes after a rain episode), and
  the scene action "Read the rain".
- A "Rain radar" dashboard widget, and a "Check the radar" button.
- Texts and documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-rainviewer/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-rainviewer/releases/tag/v1.0.0
