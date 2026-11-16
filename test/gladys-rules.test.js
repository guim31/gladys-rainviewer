// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// houses and places — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { HOME, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const houses = [
  HOME,
  {
    id: 'c2d3e4f5-2222-4c3b-9a55-0123456789ab',
    name: 'Résidence secondaire',
    selector: 'residence',
    latitude: -33.86,
    longitude: 151.21,
  },
];
const extra = 'Bureau: 48.8566, 2.3522; Chalet: 45,92 6,87';

const scenarios = [
  { label: 'default configuration (French names)', config: {} },
  { label: 'English names', config: { language: 'en' } },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const { fake } = await createWorld({
      houses,
      config: { extra_places: extra, ...scenario.config },
    });
    const devices = fake.discoveredDevices;
    assert.equal(devices.length, 4, 'one device per place');
    const deviceIds = new Set();
    for (const device of devices) {
      const where = device.name;
      assert.ok(!deviceIds.has(device.external_id), `${where}: duplicate device external_id`);
      deviceIds.add(device.external_id);

      // should_poll: true if and only if poll_frequency is provided, in ms.
      if (device.poll_frequency === undefined) {
        assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
      } else {
        assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
        assert.ok(
          table.poll_frequencies_ms.includes(device.poll_frequency),
          `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
        );
      }

      assert.ok(device.features.length > 0, `${where}: no feature`);
      const externalIds = new Set();
      const names = new Set();
      for (const feature of device.features) {
        const at = `${where} / ${feature.name}`;
        const pair = table.pairs[`${feature.category}/${feature.type}`];
        assert.ok(pair, `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`);
        assert.ok(
          pair.label_en && pair.label_fr && pair.icon,
          `${at}: couple without label or icon`,
        );

        assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
        assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
        assert.ok(
          Number.isFinite(feature.min) && Number.isFinite(feature.max),
          `${at}: finite min/max`,
        );
        assert.ok(feature.min <= feature.max, `${at}: min > max`);
        assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
        assert.equal(
          typeof feature.has_feedback,
          'boolean',
          `${at}: has_feedback must be a boolean`,
        );
        if (feature.unit !== undefined) {
          assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          const allowed = table.units_by_category[feature.category];
          if (allowed) {
            assert.ok(
              allowed.includes(feature.unit),
              `${at}: unit ${feature.unit} not offered for ${feature.category}`,
            );
          }
        }
        assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
        externalIds.add(feature.external_id);
        assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
        names.add(feature.name);
      }
    }
  });
}

test('rain is 1 when it rains; nothing is controllable; the image keeps no history', async () => {
  const { fake } = await createWorld();
  const [device] = fake.discoveredDevices;
  assert.deepEqual(
    device.features.filter((feature) => !feature.read_only),
    [],
  );
  const rain = device.features.find((feature) => feature.external_id.endsWith(':rain'));
  assert.deepEqual([rain.category, rain.type, rain.min, rain.max], ['rain-sensor', 'binary', 0, 1]);
  const image = device.features.find((feature) => feature.type === 'image');
  assert.equal(image.keep_history, false);
  // Never camera/enabled: since Gladys 5.2 it is the user's privacy mode.
  assert.ok(!device.features.some((feature) => feature.type === 'enabled'));
});

test('device external ids are stable: a house by its id, a place by its name', async () => {
  const { fake } = await createWorld({ config: { extra_places: 'Résidence d’été: 43.3, 5.4' } });
  assert.deepEqual(
    fake.discoveredDevices.map((device) => device.external_id),
    [
      `ext:test-integration:place:house-${HOME.id}`,
      'ext:test-integration:place:place-residence-d-ete',
    ],
  );
});
