'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ANCHOR_CARDS, ASSIGNMENT_CARDS } = require('../game-data');
const { seaEncounterSource } = require('../sea-encounter-source');
const { sailingEventSource } = require('../sailing-event-source');
const { assignmentPool } = require('../assignment-pool');

const ROOT = path.join(__dirname, '..');

function sourceFile(name) {
  return fs.readFileSync(path.join(ROOT, name), 'utf8');
}

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, 'Missing start marker: ' + startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, 'Missing end marker: ' + endMarker);
  return source.slice(start, end);
}

function functionSource(source, name) {
  const start = source.indexOf('function ' + name);
  assert.notEqual(start, -1, 'Missing function: ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error('Unclosed function: ' + name);
}

function firstKey(object) {
  const key = Object.keys(object || {})[0];
  assert.ok(key);
  return key;
}

test('Cartographer consumer reads the next encounter only through SeaEncounterSource.peekNext()', () => {
  const server = sourceFile('server.js');
  const handler = between(server, "onSocketEvent(socket, 'useCartographer'", "onSocketEvent(socket, 'useFirstMate'");

  assert.match(handler, /seaEncounterSource\(room, color\)\?\.peekNext\(\)/);
  assert.doesNotMatch(handler, /anchorDecks[\s\S]*drawPile/);
  assert.match(handler, /cartographerAnchorOptions\(p\)/);
  assert.match(handler, /character\.useActionCost/);
  assert.match(handler, /consumeCharacter\(p, 'cartographer'\)/);
  assert.match(handler, /anchorName: option\.name, card: \{ name: card\.name, artillery: card\.artillery, reward: card\.reward, quiet: Boolean\(card\.quiet\) \}/);
});

test('Cartographer-style peek does not consume and the next ordinary encounter is the peeked occurrence', () => {
  const color = firstKey(ANCHOR_CARDS);
  const first = { id: 'peeked', name: 'Peeked', copy: 1 };
  const second = { id: 'later', name: 'Later', copy: 1 };
  const room = { anchorDecks: { [color]: { drawPile: [first, second], discard: [] } } };
  const source = seaEncounterSource(room, color, () => 0);

  const peeked = source.peekNext();
  assert.deepEqual(peeked, first);
  assert.equal(room.anchorDecks[color].drawPile.length, 2);
  assert.deepEqual(source.consumeNext(), peeked);
  assert.equal(room.anchorDecks[color].drawPile.length, 1);
});

test('Cartographer boundary peek materializes one stable cycle and survives JSON restart without reroll', () => {
  const color = firstKey(ANCHOR_CARDS);
  const room = {
    anchorDecks: {
      [color]: {
        drawPile: [],
        discard: [
          { id: 'a', name: 'A', copy: 1 },
          { id: 'b', name: 'B', copy: 1 },
          { id: 'c', name: 'C', copy: 1 },
        ],
      },
    },
  };
  const samples = [0.8, 0.1];
  let index = 0;
  const peeked = seaEncounterSource(room, color, () => samples[index++] ?? 0).peekNext();
  const materialized = JSON.parse(JSON.stringify(room));
  assert.equal(materialized.anchorDecks[color].discard.length, 0);
  assert.equal(materialized.anchorDecks[color].drawPile.length, 3);

  const restored = JSON.parse(JSON.stringify(materialized));
  const restoredSource = seaEncounterSource(restored, color, () => 0.99);
  assert.deepEqual(restoredSource.peekNext(), peeked);
  assert.deepEqual(restoredSource.consumeNext(), peeked);
});

test('SailingEventSource replaceObserved returns first to recyclable state and consumes mandatory second', () => {
  const first = { id: 'first-observed', name: 'First', copy: 1 };
  const second = { id: 'second-mandatory', name: 'Second', copy: 1 };
  const room = { eventDeck: { drawPile: [second], discard: [] } };

  const resolved = sailingEventSource(room, () => 0).replaceObserved(first);
  assert.deepEqual(resolved, second);
  assert.deepEqual(room.eventDeck.drawPile, []);
  assert.deepEqual(room.eventDeck.discard, [first]);
});

test('Observatory keep path has no second consume while replace path uses the source semantic operation', () => {
  const server = sourceFile('server.js');
  const observatory = between(server, "if (pending.kind === 'observatory')", "if (pending.kind === 'cargo')");

  assert.match(observatory, /sailingEventSource\(room\)\.replaceObserved\(first\)/);
  assert.doesNotMatch(observatory, /drawSailingEventCard\(/);
  assert.doesNotMatch(observatory, /\.markUsed\(/);

  const replaceIndex = observatory.indexOf("if (choice === 'replace')");
  const elseIndex = observatory.indexOf('} else {', replaceIndex);
  assert.notEqual(replaceIndex, -1);
  assert.notEqual(elseIndex, -1);
  const keepBranch = observatory.slice(elseIndex);
  assert.doesNotMatch(keepBranch, /consumeNext|replaceObserved|drawSailingEventCard|markUsed/);
});

test('Observatory replacement after JSON pending resume preserves mandatory-next semantics', () => {
  const first = { id: 'resume-first', name: 'First', copy: 1 };
  const second = { id: 'resume-second', name: 'Second', copy: 1 };
  const room = {
    eventDeck: { drawPile: [second], discard: [] },
    pendingEvent: {
      id: 'pending-observatory',
      playerId: 'p1',
      kind: 'observatory',
      cardName: first.name,
      eventCard: first,
      origin: 'event-phase',
      options: [{ id: 'keep' }, { id: 'replace' }],
    },
  };
  const restored = JSON.parse(JSON.stringify(room));
  const resolved = sailingEventSource(restored, () => 0).replaceObserved(restored.pendingEvent.eventCard);

  assert.deepEqual(resolved, second);
  assert.equal(restored.pendingEvent.kind, 'observatory');
  assert.deepEqual(restored.eventDeck.discard, [first]);
  assert.deepEqual(restored.eventDeck.drawPile, []);
});

test('AssignmentPool chooseOffered returns the unchosen Embassy occurrence and keeps the chosen reserved', () => {
  const factionId = firstKey(ASSIGNMENT_CARDS);
  const chosen = { id: 'chosen', copy: 1 };
  const unchosen = { id: 'unchosen', copy: 1 };
  const room = {
    players: [],
    assignmentDecks: {
      [factionId]: { drawPile: [], discard: [], removed: [] },
    },
  };
  const pool = assignmentPool(room, factionId, () => 0, { classify: () => 'eligible' });
  const result = pool.chooseOffered([chosen, unchosen], chosen.id);

  assert.deepEqual(result.chosen, chosen);
  assert.equal(result.returned, 1);
  assert.deepEqual(room.assignmentDecks[factionId].drawPile, [unchosen]);
  assert.deepEqual(room.assignmentDecks[factionId].discard, []);
  assert.deepEqual(room.assignmentDecks[factionId].removed, []);
});

test('Embassy compatibility facades delegate offer and choice to AssignmentPool semantic operations', () => {
  const gameLogic = sourceFile('game-logic.js');
  const offer = functionSource(gameLogic, 'offerAssignmentCards');
  const choose = functionSource(gameLogic, 'chooseAssignmentOffer');

  assert.match(offer, /assignmentPoolFor\(room, factionId, rng\)/);
  assert.match(offer, /\.offerEligible\(player, count\)/);
  assert.match(choose, /assignmentPoolFor\(room, factionId, rng\)/);
  assert.match(choose, /\.chooseOffered\(offeredCards, cardId\)/);
  assert.doesNotMatch(offer + choose, /assignmentDecks|drawPile|discard|removed/);
});

test('gameplay consumers no longer read random-source storage buckets directly', () => {
  const server = sourceFile('server.js');
  const directAnchor = server.split('\n').filter(line => /anchorDecks.*drawPile/.test(line));
  const directEvent = server.split('\n').filter(line => /eventDeck.*(?:drawPile|discard)/.test(line));
  const directAssignment = server.split('\n').filter(line => /assignmentDecks.*(?:drawPile|discard|removed)/.test(line));

  assert.equal(directAnchor.length, 1);
  assert.match(directAnchor[0], /anchorDecks: Object\.fromEntries/);
  assert.equal(directEvent.length, 1);
  assert.match(directEvent[0], /sailing: \{ remaining:/);
  assert.equal(directAssignment.length, 1);
  assert.match(directAssignment[0], /assignmentDecks: Object\.fromEntries/);
});

test('Cartographer range/action/payload remain data-driven through the existing consumer contract', () => {
  const server = sourceFile('server.js');
  const gameLogic = sourceFile('game-logic.js');
  const handler = between(server, "onSocketEvent(socket, 'useCartographer'", "onSocketEvent(socket, 'useFirstMate'");
  const options = functionSource(gameLogic, 'cartographerAnchorOptions');

  assert.match(options, /CHARACTERS\.cartographer\?\.effect\?\.range/);
  assert.match(handler, /character\.useActionCost/);
  assert.match(handler, /cartographerAnchorOptions\(p\)/);
  assert.match(handler, /ackSafe\(ack, \{ ok: true, anchorName: option\.name, card:/);
});
