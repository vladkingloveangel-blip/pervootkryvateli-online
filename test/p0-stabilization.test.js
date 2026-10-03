const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  battleLevelLoss,
  assignmentRequiredAction,
  sellCargo,
  shipCargoCapacity,
} = require('../game-logic');
const {
  ASSIGNMENT_CARDS,
  ESCORTS,
  GOODS,
  BUILDINGS,
} = require('../game-data');

function sourceFile(name) {
  return fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, 'missing start marker: ' + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, 'missing end marker: ' + endMarker);
  return source.slice(start, end);
}

test('P0 character handlers reject repeated use before authoritative mutation', () => {
  const server = sourceFile('server.js');

  const navigator = between(server, "onSocketEvent(socket, 'useNavigator'", "onSocketEvent(socket, 'useCartographer'");
  const navConsume = navigator.indexOf("consumeCharacter(p, 'navigator', room.round)");
  assert.ok(navConsume >= 0);
  assert.ok(navConsume < navigator.indexOf('const second = rollD6()'));
  assert.ok(navConsume < navigator.indexOf('room.roll = second'));
  assert.ok(navConsume < navigator.indexOf('room.movePoints ='));
  assert.ok(navConsume < navigator.indexOf('room.actionsLeft -= character.useActionCost'));

  const cartographer = between(server, "onSocketEvent(socket, 'useCartographer'", "onSocketEvent(socket, 'useScout'");
  const cartConsume = cartographer.indexOf("consumeCharacter(p, 'cartographer', room.round)");
  assert.ok(cartConsume >= 0);
  assert.ok(cartConsume < cartographer.indexOf('room.actionsLeft -= character.useActionCost'));

  const firstMate = between(server, "onSocketEvent(socket, 'useFirstMate'", "onSocketEvent(socket, 'usePalace'");
  const mateConsume = firstMate.indexOf("consumeCharacter(p, 'firstMate', room.round)");
  assert.ok(mateConsume >= 0);
  assert.ok(mateConsume < firstMate.indexOf('room.actionsLeft = Math.max'));

  const treasureHunter = between(server, "onSocketEvent(socket, 'useTreasureHunter'", "onSocketEvent(socket, 'useFirstMate'");
  const treasureConsume = treasureHunter.indexOf("consumeCharacter(p, 'treasureHunter', room.round)");
  assert.ok(treasureConsume >= 0);
  assert.ok(treasureConsume < treasureHunter.indexOf('room.actionsLeft -= actionCost'));
  assert.ok(treasureConsume < treasureHunter.indexOf("setPendingLegacy(room, 'event'"));

  const scout = sourceFile('scout-runtime.js');
  const scoutUse = between(scout, 'function applyScoutUse(', 'function normalizeScoutRevealGrant(');
  const scoutConsume = scoutUse.indexOf("consumeCharacter(player, 'scout')");
  assert.ok(scoutConsume >= 0);
  assert.ok(scoutConsume < scoutUse.indexOf('room.actionsLeft ='));
  assert.ok(scoutConsume < scoutUse.indexOf('room.scoutRevealGrants ='));
});

test('P0 Ship Carpenter prevents level loss only once per round', () => {
  const room = { round: 7, islands: [] };
  const player = {
    id: 'p1',
    shipClass: 'brigantine',
    level: 2,
    upgrades: [],
    escorts: [],
    cargo: null,
    character: { id: 'shipCarpenter' },
    characterUsedRound: null,
  };

  const first = battleLevelLoss(room, player, { useShipCarpenter: true });
  assert.equal(first.prevented, true);
  assert.equal(first.preventedByCharacter, 'shipCarpenter');
  assert.equal(player.level, 2);
  assert.equal(player.characterUsedRound, 7);
  assert.equal(player.character.id, 'shipCarpenter');

  const second = battleLevelLoss(room, player, { useShipCarpenter: true });
  assert.equal(second.prevented, false);
  assert.equal(second.preventedByCharacter, null);
  assert.equal(player.level, 1);
  assert.equal(player.characterUsedRound, 7);
  assert.equal(player.character.id, 'shipCarpenter');
});

function deliveryCardFixture() {
  for (const [factionId, cards] of Object.entries(ASSIGNMENT_CARDS || {})) {
    for (const card of cards || []) {
      if (card?.type === 'delivery' && Array.isArray(card.goodIds) && card.goodIds.length) {
        return { factionId, card };
      }
    }
  }
  throw new Error('No delivery assignment fixture found');
}

function cargoEscortFixture() {
  const entry = Object.entries(ESCORTS || {}).find(([, def]) => !def?.retired && Number(def?.cargo) > 0);
  if (!entry) throw new Error('No active cargo escort definition found');
  return { type: entry[0], def: entry[1] };
}

function makeDeliveryState({ main = true, escort = false, escortActive = true, landCompany = false, mismatchedGood = false, assignment = true } = {}) {
  const delivery = deliveryCardFixture();
  const cargoEscort = cargoEscortFixture();
  const goodId = delivery.card.goodIds[0];
  const otherGoodId = Object.keys(GOODS || {}).find(id => !delivery.card.goodIds.includes(id)) || goodId;
  const assignmentId = 'delivery-current';
  const player = {
    id: 'p1',
    row: 13,
    col: 13,
    shipClass: 'brigantine',
    level: 3,
    upgrades: [],
    escorts: [],
    cargo: null,
    ducats: 0,
    landCompany: landCompany ? { army: 4 } : null,
    activeAssignment: assignment ? { instanceId: assignmentId, factionId: delivery.factionId, card: { ...delivery.card } } : null,
  };
  const maxShipyardLevel = Math.max(...Object.keys(BUILDINGS.shipyard.levels || {}).map(Number));
  const islands = escortActive
    ? [{ id: 'yard', ownerId: 'p1', buildings: [{ type: 'shipyard', level: maxShipyardLevel }] }]
    : [];
  const room = { round: 2, islands, players: [player], alliances: [] };

  if (main) {
    player.cargo = {
      goodId: mismatchedGood ? otherGoodId : goodId,
      quantity: shipCargoCapacity(player),
      assignmentInstanceId: assignmentId,
    };
  }
  if (escort) {
    player.escorts.push({
      id: 'escort-cargo',
      type: cargoEscort.type,
      special: false,
      cargo: {
        goodId: mismatchedGood ? otherGoodId : goodId,
        quantity: Number(cargoEscort.def.cargo),
        assignmentInstanceId: assignmentId,
      },
    });
  }
  return { room, player, goodId };
}

test('P0 fleet-wide delivery priority accepts any sellable matching active hold without restoring holdId API', () => {
  const server = sourceFile('server.js');
  const priority = between(server, 'function assignmentPriorityAllows(', 'function assignmentPriorityError(');
  const deliveryBranch = between(priority, "if (requirement.kind === 'delivery')", "if (requirement.kind === 'assault')");
  assert.match(deliveryBranch, /event === 'sellCargo'/);
  assert.match(deliveryBranch, /\(requirement\.holdIds \|\| \[\]\)\.length > 0/);
  assert.doesNotMatch(deliveryBranch, /data\?\.holdId|includes\(holdId\)|'main'/);

  const sellHandler = between(server, "onSocketEvent(socket, 'sellCargo'", "onSocketEvent(socket, 'respondEvent'");
  assert.doesNotMatch(sellHandler, /data\?\.holdId/);
  assert.equal((sellHandler.match(/room\.actionsLeft -= 1/g) || []).length, 1);

  let state = makeDeliveryState({ main: true });
  assert.deepEqual(assignmentRequiredAction(state.room, state.player, 1).holdIds, ['main']);

  state = makeDeliveryState({ main: false, escort: true });
  assert.deepEqual(assignmentRequiredAction(state.room, state.player, 1).holdIds, ['escort-cargo']);

  state = makeDeliveryState({ main: true, escort: true });
  assert.deepEqual(assignmentRequiredAction(state.room, state.player, 1).holdIds, ['main', 'escort-cargo']);
  const bothSale = sellCargo(state.room, state.player);
  assert.equal(bothSale.ok, true);
  assert.equal(bothSale.sales.length, 2);

  state = makeDeliveryState({ main: false, escort: true, landCompany: true });
  assert.deepEqual(assignmentRequiredAction(state.room, state.player, 1).holdIds, ['escort-cargo']);
  assert.equal(sellCargo(state.room, state.player).ok, true);

  state = makeDeliveryState({ main: false, escort: true, escortActive: false });
  assert.equal(assignmentRequiredAction(state.room, state.player, 1), null);
  const inactiveCargo = state.player.escorts[0].cargo;
  assert.equal(sellCargo(state.room, state.player).ok, false);
  assert.deepEqual(state.player.escorts[0].cargo, inactiveCargo);

  state = makeDeliveryState({ main: true, mismatchedGood: true });
  assert.equal(assignmentRequiredAction(state.room, state.player, 1), null);

  state = makeDeliveryState({ main: true, assignment: false });
  const ordinarySale = sellCargo(state.room, state.player);
  assert.equal(ordinarySale.ok, true);
  assert.equal(ordinarySale.sales.length, 1);
  assert.equal(state.player.cargo, null);
});

test('P0 renderIsland binds room before Arsenal and Palace runtime branches use r', () => {
  const app = sourceFile('public/app.js');
  const renderer = between(app, '  function renderIsland()', '\n  function ');
  const declaration = renderer.indexOf('const r = state.room;');
  assert.ok(declaration >= 0);
  for (const match of renderer.matchAll(/\br\./g)) {
    assert.ok(declaration < match.index, 'room alias must exist before every r.* access');
  }
  assert.match(renderer, /r\.balanceCatalog\.landCompany\.armyByArsenalLevel/);
  assert.match(renderer, /\(r\.factions \|\| \[\]\)\.find/);
});
