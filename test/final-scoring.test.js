const test = require('node:test');
const assert = require('node:assert/strict');
const { PLACE_DISCOVERY_DEFINITIONS, EXPEDITION_DEFINITIONS } = require('../game-data');
const { calculatePlayerFinalMetrics, calculateFinalScoring } = require('../final-scoring');

function building(type, level = 1) {
  return { type, level };
}

function island(id, ownerId, buildings) {
  return { id, ownerId, buildings };
}

function title(scoring, id) {
  return scoring.titles.find(entry => entry.id === id);
}

test('calculatePlayerFinalMetrics covers all six canonical metrics without cached island counts', () => {
  const player = {
    id: 'p1',
    ducats: 90,
    debt: 20,
    armyPoints: 8,
    fleetPoints: 6,
    islandCount: 999,
    ownedIslandCount: 999,
  };
  const namedOne = PLACE_DISCOVERY_DEFINITIONS[0];
  const namedTwo = PLACE_DISCOVERY_DEFINITIONS[1];
  const expedition = EXPEDITION_DEFINITIONS[0];
  const room = {
    players: [player],
    islands: [
      island('settlement', 'p1', [building('farm')]),
      island('city', 'p1', [
        building('manor', 1), building('lumbermill'), building('quarry'), building('mine'), building('market'),
      ]),
      island('port', 'p1', [
        building('manor', 2), building('shipyard'), building('stoneworks'), building('arsenal'),
        building('fortress'), building('bank'), building('market'),
      ]),
      island('public', 'p1', [
        building('farm'), building('lighthouse'), building('embassy'), building('palace'), building('admiralty', 3),
      ]),
      island('other-player', 'p2', [building('farm')]),
    ],
    discoveries: {
      [namedOne.id]: { ownerId: 'p1' },
      [namedTwo.id]: { ownerId: 'p1' },
      [expedition.id]: { ownerId: 'p1' },
      'not-a-canonical-place': { ownerId: 'p1' },
    },
  };

  assert.deepEqual(calculatePlayerFinalMetrics(room, player), {
    islands: 4,
    wealth: 70,
    army: 8,
    fleet: 6,
    prestige: 12,
    legendaryPlaces: 2,
  });
});

test('calculateFinalScoring shares ties, excludes players without islands, and allows multiple titles', () => {
  const namedOne = PLACE_DISCOVERY_DEFINITIONS[0];
  const room = {
    players: [
      { id: 'p1', ducats: 50, debt: 5, armyPoints: 9, fleetPoints: 7 },
      { id: 'p2', ducats: 40, debt: 0, armyPoints: 3, fleetPoints: 7 },
      { id: 'p3', ducats: 999, debt: 0, armyPoints: 999, fleetPoints: 999 },
    ],
    islands: [
      island('p1-a', 'p1', [
        building('manor', 1), building('lumbermill'), building('quarry'), building('mine'), building('market'), building('palace'),
      ]),
      island('p1-b', 'p1', [building('farm')]),
      island('p2-a', 'p2', [building('farm')]),
    ],
    discoveries: {
      [namedOne.id]: { ownerId: 'p1' },
    },
  };

  const scoring = calculateFinalScoring(room);
  assert.deepEqual(title(scoring, 'islands').winnerIds, ['p1']);
  assert.deepEqual(title(scoring, 'wealth').winnerIds, ['p1']);
  assert.deepEqual(title(scoring, 'army').winnerIds, ['p1']);
  assert.deepEqual(title(scoring, 'fleet').winnerIds, ['p1', 'p2']);
  assert.deepEqual(title(scoring, 'prestige').winnerIds, ['p1']);
  assert.deepEqual(title(scoring, 'legendaryPlaces').winnerIds, ['p1']);
  assert.equal(scoring.titles.some(entry => entry.winnerIds.includes('p3')), false);
  assert.equal(Object.hasOwn(scoring, 'overallScore'), false);
  assert.equal(Object.hasOwn(scoring, 'winnerId'), false);
});

test('calculateFinalScoring returns empty winnerIds when nobody owns an island', () => {
  const scoring = calculateFinalScoring({
    players: [{ id: 'p1', ducats: 100 }, { id: 'p2', armyPoints: 10 }],
    islands: [],
    discoveries: {},
  });
  assert.equal(scoring.titles.length, 6);
  for (const entry of scoring.titles) {
    assert.deepEqual(entry.winnerIds, []);
    assert.equal(entry.maxValue, null);
  }
});

test('final scoring is pure and does not mutate room, players, islands, buildings, or discoveries', () => {
  const namedOne = PLACE_DISCOVERY_DEFINITIONS[0];
  const room = {
    players: [{ id: 'p1', ducats: 10, debt: 2, armyPoints: 1, fleetPoints: 2 }],
    islands: [island('i1', 'p1', [building('farm'), building('admiralty', 2)])],
    discoveries: { [namedOne.id]: { ownerId: 'p1' } },
  };
  const before = JSON.parse(JSON.stringify(room));

  calculatePlayerFinalMetrics(room, room.players[0]);
  calculateFinalScoring(room);

  assert.deepEqual(room, before);
});
