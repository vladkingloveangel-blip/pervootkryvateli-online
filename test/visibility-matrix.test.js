const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixturePath = path.join(__dirname, 'fixtures', 'visibility-matrix.json');
const VIEWER_ROLES = ['owner', 'opponent', 'scout', 'pendingActor', 'publicObserver'];
const ALLOWED_ACCESS = new Set(['visible', 'omitted', 'conditional']);

function loadFixture() {
  assert.equal(fs.existsSync(fixturePath), true, 'visibility fixture must exist');
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function byKey(fixture) {
  return new Map(fixture.policies.map(row => [row.key, row]));
}

test('visibility matrix fixture exists, parses, and defines every viewer role on every policy row', () => {
  const fixture = loadFixture();
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(
    fixture.securityInvariant,
    'hidden means omitted from unauthorized payload, not merely hidden in UI'
  );
  assert.deepEqual(Object.keys(fixture.viewerRoles).sort(), [...VIEWER_ROLES].sort());
  assert.ok(Array.isArray(fixture.policies) && fixture.policies.length > 0);

  const seen = new Set();
  for (const row of fixture.policies) {
    assert.equal(typeof row.key, 'string');
    assert.ok(row.key.length > 0);
    assert.equal(seen.has(row.key), false, `duplicate policy key: ${row.key}`);
    seen.add(row.key);
    assert.equal(typeof row.entity, 'string');
    assert.equal(typeof row.propertyGroup, 'string');
    assert.equal(typeof row.privacySensitive, 'boolean');
    assert.ok(Array.isArray(row.properties) && row.properties.length > 0);

    for (const role of VIEWER_ROLES) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(row.visibility, role),
        `${row.key} is missing ${role} visibility`
      );
      assert.ok(
        ALLOWED_ACCESS.has(row.visibility[role]),
        `${row.key} has invalid ${role} visibility: ${row.visibility[role]}`
      );
    }
  }
});

test('fixture covers all approved visibility categories', () => {
  const rows = byKey(loadFixture());
  const required = [
    'island.publicState',
    'island.garrison',
    'ship.publicState',
    'ship.cargo',
    'player.ducats',
    'player.debt',
    'player.character',
    'politics.suzerainRelation',
    'player.activeAssignment',
    'player.activeAssignmentExistenceAndSignals',
    'player.privateAbilities',
    'player.savedBenefits',
    'player.activeExpedition',
    'player.activeTemporaryEffects',
    'player.landCompany',
    'player.anchorHistory',
    'discoveries.completedHistory',
    'pending.privateContent',
    'pending.publicEnvelope',
    'catalogs.publicDefinitions',
  ];
  for (const key of required) assert.ok(rows.has(key), `missing approved category: ${key}`);

  assert.deepEqual(loadFixture().scoutRule.revealModes, [
    'selected-garrison',
    'selected-player-ducats',
  ]);
});

test('opponent and public observer receive no approved private player/island categories', () => {
  const rows = byKey(loadFixture());
  const privateKeys = [
    'island.garrison',
    'player.ducats',
    'player.debt',
    'player.character',
    'player.activeAssignment',
    'player.activeAssignmentExistenceAndSignals',
    'player.privateAbilities',
    'player.savedBenefits',
    'player.activeExpedition',
    'pending.privateContent',
  ];

  for (const key of privateKeys) {
    const row = rows.get(key);
    assert.equal(row.privacySensitive, true, `${key} must be privacy-sensitive`);
    assert.equal(row.visibility.opponent, 'omitted', `${key} leaked to opponent`);
    assert.equal(row.visibility.publicObserver, 'omitted', `${key} leaked to publicObserver`);
  }

  assert.ok(rows.get('player.activeAssignmentExistenceAndSignals').properties.includes('hasActiveAssignment'));
  assert.ok(rows.get('player.privateAbilities').properties.some(p => p.includes('counts')));
  assert.ok(rows.get('player.savedBenefits').properties.some(p => p.includes('counts')));
  assert.ok(rows.get('player.activeExpedition').properties.includes('hasActiveExpedition'));
});

test('Scout override exists only for one selected garrison or one selected other player ducat value', () => {
  const fixture = loadFixture();
  const rows = byKey(fixture);
  const overrides = fixture.policies
    .filter(row => row.visibility.scout === 'conditional')
    .map(row => row.key)
    .sort();

  assert.deepEqual(overrides, ['island.garrison', 'player.ducats']);
  assert.equal(rows.get('island.garrison').scoutOverride, 'selected-garrison');
  assert.match(rows.get('island.garrison').conditions.scout, /one selected island/i);
  assert.equal(rows.get('player.ducats').scoutOverride, 'selected-player-ducats');
  assert.match(rows.get('player.ducats').conditions.scout, /one selected other player/i);

  const scoutMustNotReveal = [
    'player.debt',
    'player.character',
    'player.activeAssignment',
    'player.activeAssignmentExistenceAndSignals',
    'player.privateAbilities',
    'player.savedBenefits',
    'player.activeExpedition',
    'pending.privateContent',
  ];
  for (const key of scoutMustNotReveal) {
    assert.equal(rows.get(key).visibility.scout, 'omitted', `Scout unexpectedly reveals ${key}`);
  }

  assert.equal(fixture.scoutRule.range, 4);
  assert.equal(fixture.scoutRule.distance, 'Manhattan');
  assert.equal(fixture.scoutRule.useActionCost, 1);
  assert.equal(fixture.scoutRule.consumesCharacterAfterUse, true);
  assert.equal(fixture.scoutRule.exactlyOneRevealModePerUse, true);
  assert.equal(fixture.scoutRule.reconnectWithinSamePersonalTurnPreservesGrant, true);
  assert.equal(fixture.scoutRule.endOfPersonalTurnExpiresGrant, true);
});

test('owner sees own private categories and pendingActor sees only its exact private pending content', () => {
  const rows = byKey(loadFixture());
  const ownerPrivateKeys = [
    'island.garrison',
    'player.ducats',
    'player.debt',
    'player.character',
    'player.activeAssignment',
    'player.activeAssignmentExistenceAndSignals',
    'player.privateAbilities',
    'player.savedBenefits',
    'player.activeExpedition',
  ];
  for (const key of ownerPrivateKeys) {
    assert.equal(rows.get(key).visibility.owner, 'visible', `owner cannot see ${key}`);
  }

  for (const row of rows.values()) {
    if (row.key === 'pending.privateContent') continue;
    if (row.privacySensitive) {
      assert.equal(
        row.visibility.pendingActor,
        'omitted',
        `pendingActor unexpectedly gains unrelated private access to ${row.key}`
      );
    }
  }

  const pending = rows.get('pending.privateContent');
  assert.equal(pending.visibility.pendingActor, 'conditional');
  assert.match(pending.conditions.pendingActor, /exact pending resolution/i);
  assert.equal(pending.visibility.owner, 'omitted');
  assert.equal(pending.visibility.scout, 'omitted');
});

test('approved public world, ship, cargo, politics, discoveries, waiting envelope and catalogs remain public', () => {
  const rows = byKey(loadFixture());
  const publicKeys = [
    'island.publicState',
    'ship.publicState',
    'ship.cargo',
    'player.activeTemporaryEffects',
    'player.landCompany',
    'player.anchorHistory',
    'politics.suzerainRelation',
    'discoveries.completedHistory',
    'pending.publicEnvelope',
    'catalogs.publicDefinitions',
  ];

  for (const key of publicKeys) {
    const row = rows.get(key);
    assert.equal(row.privacySensitive, false);
    for (const role of VIEWER_ROLES) {
      assert.equal(row.visibility[role], 'visible', `${key} must remain public for ${role}`);
    }
  }
});

test('pre-4.3 addendum fixes debt, applied effects, land company and anchor history semantics', () => {
  const rows = byKey(loadFixture());

  const debt = rows.get('player.debt');
  assert.deepEqual(debt.visibility, {
    owner: 'visible',
    opponent: 'omitted',
    scout: 'omitted',
    pendingActor: 'omitted',
    publicObserver: 'omitted',
  });
  assert.ok(debt.properties.includes('debt'));
  assert.match(debt.notes, /Scout money reveal applies only to ducats/i);

  for (const key of ['player.activeTemporaryEffects', 'player.landCompany', 'player.anchorHistory']) {
    const row = rows.get(key);
    assert.equal(row.privacySensitive, false);
    for (const role of VIEWER_ROLES) {
      assert.equal(row.visibility[role], 'visible', `${key} must remain public for ${role}`);
    }
  }

  assert.match(rows.get('player.activeTemporaryEffects').notes, /originating hidden held card/i);
  assert.equal(rows.get('player.anchorHistory').transitionStatus, 'current-public/transitional');
  assert.match(rows.get('player.anchorHistory').notes, /outside this visibility switch/i);
});
