'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = require('../rules/runtime');
const gameData = require('../game-data');
const rules = require('../rules');

const PAIRS = [
  ['SEA_ENCOUNTER_DEFINITIONS', 'ANCHOR_CARDS'],
  ['SAILING_EVENT_DEFINITIONS', 'SAILING_EVENT_CARDS'],
  ['POLITICAL_EFFECT_DEFINITIONS', 'FEUD_CARDS'],
  ['ASSIGNMENT_DEFINITIONS', 'ASSIGNMENT_CARDS'],
  ['EXPEDITION_DEFINITIONS', 'EXPEDITION_CARDS'],
  ['TREASURE_OUTCOME_DEFINITIONS', 'TREASURE_CARDS'],
  ['CONSUMABLE_ABILITY_DEFINITIONS', 'LEGENDARY_CARDS'],
  ['PLACE_DISCOVERY_DEFINITIONS', 'NAMED_PLACE_CARDS'],
];

function flattenDefinitions(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value).flat();
  return [];
}

test('all eight semantic catalogs are canonical and legacy aliases have strict identity', () => {
  for (const [semantic, legacy] of PAIRS) {
    assert.ok(runtime[semantic], semantic);
    assert.strictEqual(runtime[legacy], runtime[semantic], semantic + ' runtime alias identity');
    assert.strictEqual(gameData[semantic], runtime[semantic], semantic + ' game-data semantic identity');
    assert.strictEqual(gameData[legacy], runtime[semantic], legacy + ' game-data legacy identity');
  }
});

test('semantic definition content exactly preserves the existing rules projection', () => {
  assert.deepEqual(runtime.SEA_ENCOUNTER_DEFINITIONS, rules.sea);
  assert.deepEqual(runtime.SAILING_EVENT_DEFINITIONS, rules.events.sailing);

  const expectedPolitical = Object.fromEntries(Object.entries(rules.events.feud).map(([factionId, cards]) => [
    factionId,
    cards.map(card => ({
      id: card.id,
      masterCardId: card.id,
      factionId,
      name: card.name,
      quantity: card.quantity,
      source: card.source,
      ...JSON.parse(JSON.stringify(card.effect)),
    })),
  ]));
  assert.deepEqual(runtime.POLITICAL_EFFECT_DEFINITIONS, expectedPolitical);

  const expectedAssignments = Object.fromEntries(runtime.POLITICAL_FACTION_ORDER
    .filter(id => runtime.FACTIONS[id]?.canHaveVassal)
    .map(id => [id, JSON.parse(JSON.stringify(rules.politics.assignments[id] || []))]));
  assert.deepEqual(runtime.ASSIGNMENT_DEFINITIONS, expectedAssignments);

  assert.deepEqual(runtime.EXPEDITION_DEFINITIONS, rules.legends.expeditions);
  assert.deepEqual(runtime.TREASURE_OUTCOME_DEFINITIONS, rules.legends.treasures);
  assert.deepEqual(runtime.CONSUMABLE_ABILITY_DEFINITIONS, rules.legends.legendary);
  assert.deepEqual(runtime.PLACE_DISCOVERY_DEFINITIONS, rules.legends.namedCards);
});

test('order, identities and cyclic quantity invariants are unchanged under semantic names', () => {
  assert.deepEqual(Object.keys(runtime.ASSIGNMENT_DEFINITIONS), ['lionia', 'kadingir', 'mori', 'suniksiya', 'pirates']);
  assert.equal(Object.values(runtime.ASSIGNMENT_DEFINITIONS).flat().length, 49);

  assert.equal(runtime.SAILING_EVENT_DEFINITIONS.reduce((sum, definition) => sum + definition.quantity, 0), 26);
  for (const factionId of runtime.POLITICAL_FACTION_ORDER) {
    const total = (runtime.POLITICAL_EFFECT_DEFINITIONS[factionId] || [])
      .reduce((sum, definition) => sum + definition.quantity, 0);
    assert.equal(total, 10, factionId);
  }

  assert.equal(Object.keys(runtime.SEA_ENCOUNTER_DEFINITIONS).length, 3);
  assert.equal(runtime.EXPEDITION_DEFINITIONS.length, 7);
  assert.deepEqual(runtime.EXPEDITION_DEFINITIONS.map(definition => definition.placeId),
    ['kraken', 'abyss', 'pharaoh', 'pearl', 'vortex', 'icebergs', 'rose']);
  assert.deepEqual(runtime.TREASURE_OUTCOME_DEFINITIONS.map(definition => definition.id),
    ['income-x1', 'income-x2', 'income-x3', 'full-diamonds-hold']);
  assert.equal(runtime.PLACE_DISCOVERY_DEFINITIONS.length, 10);
  assert.equal(runtime.PLACE_DISCOVERY_DEFINITIONS.every(definition =>
    definition.quantity === 1 && definition.visibility === 'public'), true);
});

test('naming cleanup adds no definition metadata or cycleMultiplicity field', () => {
  for (const [semantic] of PAIRS) {
    for (const definition of flattenDefinitions(runtime[semantic])) {
      for (const field of ['definitionKind', 'semanticType', 'cycleMultiplicity', 'domainKind']) {
        assert.equal(Object.hasOwn(definition, field), false, semantic + ':' + definition.id + ':' + field);
      }
    }
  }
});

test('normal production consumers no longer read legacy *_CARDS catalog names', () => {
  const root = path.join(__dirname, '..');
  const files = [
    'sea-encounter-source.js',
    'sailing-event-source.js',
    'political-effect-source.js',
    'assignment-pool.js',
    'expedition-pool.js',
    'digital-random-sources.js',
    'game-logic.js',
    'server.js',
  ];
  const legacyNames = PAIRS.map(([, legacy]) => legacy);
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    for (const legacy of legacyNames) {
      assert.equal(source.includes(legacy), false, file + ':' + legacy);
    }
  }
});
