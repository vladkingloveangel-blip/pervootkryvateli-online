# Блок 2 — roadmap перехода к digital-native архитектуре

Дата: 2026-09-30  
Ветка: `digital-native/refactor`  
Исходный HEAD: `88ed29bacdea39ca232a9878b052847886a45d26`  
Основание:
- `docs/digital-native-card-deck-audit.md`;
- `docs/digital-native-entity-mapping.md`;
- авторское уточнение: Искатель сокровищ делает два независимых uniform selection with replacement; результаты могут совпасть; distinct-selection и `treasureDeck` запрещены.

## 1. Назначение roadmap

Этот документ задаёт исполнимую последовательность маленьких implementation slices для блоков 3–6. Каждый slice должен:
- помещаться в один рабочий запрос;
- завершаться запускаемой веткой;
- иметь собственные regression tests;
- заканчиваться отдельным commit;
- не оставлять скрытый «полупереезд», при котором часть runtime пишет в старую модель, а другая часть уже считает новой модель authoritative без явного adapter layer.

На этапе этого документа runtime-код, room state и save format не меняются.

## 2. Общая стратегия перехода

**Сначала API, потом storage.** Блок 3 вводит digital random-source API поверх текущих persisted `anchorDecks/eventDeck/feudDecks/assignmentDecks/expeditionDeck`. Старые room fields остаются storage adapters до блока 6.

**Visibility отдельно от доменной модели.** Блок 4 переводит выдачу состояния клиентам на server-side projection policy. Ни один client не должен получать запрещённые opponent-private свойства «на всякий случай».

**Internal model через facades.** Блок 5 переводит consumers на Task/Ability/StoredBenefit/Discovery/TemporaryEffect/PendingResolution abstractions, но до блока 6 старые persisted fields продолжают быть backing storage через явно названные adapters.

**Storage cutover последним.** Блок 6 вводит versioned idempotent save migration, переносит старые room snapshots в новый persisted shape и только затем удаляет legacy write paths.

Рекомендуемые новые технические модули при реализации:
- `random-sources.js` — source contracts и compatibility adapters;
- `state-projection.js` — server visibility policy;
- `domain-state.js` — internal model facades/adapters;
- `save-migrations.js` — versioned idempotent migration;
- `test/random-sources.test.js`;
- `test/visibility.test.js`;
- `test/domain-state.test.js`;
- `test/save-migration.test.js`.

Названия могут быть скорректированы в implementation slice, но ответственность модулей должна оставаться разделённой.

## 3. Блок 3 — digital random sources

Цель блока 3: все gameplay consumers обращаются к семантическим source API, а не напрямую к `drawPile/discard/removed`. Persisted room shape остаётся старым до блока 6.

### 3.1. Общий source contract и deterministic test harness

**Файлы/подсистемы:** новый `random-sources.js`, `game-logic.js` только для exports/adapters, новый `test/random-sources.test.js`, при необходимости `package.json` для включения теста.

**Новый API/тип:** source-specific wrappers с операциями `consumeNext()`, `peekNext()` только для ordered source, `reserveOccurrence()/releaseOccurrence()` только для reservable source, `remainingCount()` и source-specific eligibility callbacks. Не создавать универсальную Deck-модель с обязательными piles.

**Compatibility adapters:** все текущие room fields остаются единственным storage. Wrapper читает/меняет старые поля и воспроизводит прежнее поведение.

**Инварианты:** deterministic RNG даёт тот же порядок; cycle/source contracts не меняют probabilities; adapter не добавляет persisted state.

**Старые тесты:** весь `npm test` и `npm run test:data`.

**Новые regression tests:** independent, cyclic, stable-peek, reservable и filtered-pool contracts на минимальных fixtures.

**Commit boundary:** только contracts/harness/adapters; production consumers ещё не переключать.

**Нельзя менять:** room fields, JSONB, rules data, UI и игровую механику.

### 3.2. Stateless TreasureOutcomeSource и LegendaryAbilitySource

**Файлы:** `random-sources.js`, `game-logic.js`, `test/random-sources.test.js`, `test/game-logic.test.js`.

**Новый API:** `selectTreasureOutcome(rng)`, `selectLegendaryAbility(rng)`, `selectTreasureCandidates(count, rng)`. Последняя операция делает count независимых selection with replacement.

**Adapters:** старые `drawTreasureCard`/`drawLegendaryCard` остаются wrappers и делегируют selectors.

**Инварианты:** treasure — 4 результата по 25%; legendary — uniform по четырём typeIds; repeated identical result разрешён; samples не мутируют room и не создают source state.

**Старые тесты:** treasure/legendary game-logic, Stage 6 legendary, rules data/compatibility.

**Новые тесты:** repeated outcome подряд; два Treasure Hunter candidates могут совпасть; selectors не читают `treasureDeck/legendaryDeck`.

**Commit boundary:** stateless API + wrappers.

**Нельзя:** активировать player-facing Treasure Hunter choice, создавать deck/pile или менять outcomes.

### 3.3. SeaEncounterSource поверх anchorDecks

**Файлы:** `random-sources.js`, `game-logic.js`, `server.js`, random-source/game-logic/server tests.

**Новый API:** `seaEncounterSource(room, color)` с `consumeNext()`, `peekNext()`, `remainingCount()` и cycle refresh.

**Adapter:** backing storage остаётся `room.anchorDecks[color].drawPile/discard`. `createAnchorDecks` остаётся до блока 6.

**Инварианты:** три независимых color cycles; current multiplicities; without replacement; exact reshuffle boundary; stable non-consuming peek; restart сохраняет уже наблюдаемый next result.

**Старые тесты:** anchor draw/resolve, restart top-card behavior, rules quantities.

**Новые тесты:** peek→consume equality; повторный peek stable; consume другого color не меняет source; cycle boundary сохраняет multiset.

**Commit boundary:** только source и encounter draw path. Картограф пока может оставаться direct compatibility consumer.

**Нельзя:** менять combat/action rules, `visitedAnchors` или public payload names.

### 3.4. SailingEventSource поверх eventDeck

**Файлы:** `random-sources.js`, `game-logic.js`, `server.js`, random-source/Stage-6-events/party-clock tests.

**Новый API:** `sailingEventSource(room)` с `consumeNext()`, `markUsed()`, `reserve()`, `releaseReserved()` и current-cycle counters.

**Adapter:** backing `room.eventDeck`; current `savedEventCards.sourceCard` остаётся reservation adapter; existing discard helper временно делегирует source semantics.

**Инварианты:** 26-occurrence cycle; occurrence не повторяется до разрешённого возврата; held event остаётся вне source; use/discard освобождает его; pending restart не redraw; Observatory reject не применяет first outcome, но помечает его использованным.

**Старые тесты:** Stage 6 events, party clock, event game-logic.

**Новые тесты:** held occurrence нельзя redraw; release exactly once; pending save keeps exact occurrence; cycle with reservation не дублирует occurrence.

**Commit boundary:** source + normal sailing draw/reserve/release plumbing.

**Нельзя:** менять event effects, Observatory UI/choice или `savedEventCards` shape.

**CHECKPOINT A — полный GitHub review 3.1–3.4.** Проверить deterministic traces, restart и отсутствие save-shape изменений.

### 3.5. PoliticalEffectSource поверх feudDecks

**Файлы:** `random-sources.js`, `game-logic.js`, `server.js`, random-source/Stage-6-events/rules-effects tests.

**Новый API:** `politicalEffectSource(room, factionId)` с cyclic consume/recycle semantics.

**Adapter:** `room.feudDecks[factionId]`; legacy `canonicalFeudCard/masterCardId` остаются.

**Инварианты:** отдельный 10-occurrence multiset/faction; no repeat до cycle refresh; pending effect identity stable through restart.

**Старые тесты:** feud flow, rules effects/data/compatibility.

**Новые тесты:** exact faction multiset; cycle refresh; pending choice не вызывает второй consume.

**Commit boundary:** feud source + draw/release consumers.

**Нельзя:** менять political effects и pendingFeud shape.

### 3.6. AssignmentPool поверх assignmentDecks

**Файлы:** `random-sources.js`, `game-logic.js`, `server.js`, random-source/game-logic/Stage-6-events tests.

**Новый API:** `assignmentPool(room, factionId)`: `offerEligible(player,count)`, `reserve()`, `returnUnchosen()`, `recycleCompleted()`, `excludePermanently()`.

**Adapter:** `drawPile/discard/removed` remain backing; `activeAssignment.card` и `pendingAssignmentChoice.options` remain old shape.

**Инварианты:** eligible/skip/remove различны; skip возвращается, remove permanent; offered candidates reserved до выбора; complete/cancel recycle; active task не available одновременно.

**Старые тесты:** eligibility, offer/choose, completion, Embassy Stage 6 flow.

**Новые тесты:** все три eligibility states; skip future-eligible; permanent removed never returns; two offered reservations; one-candidate case.

**Commit boundary:** pool API + current assignment draw/return/complete paths.

**Нельзя:** менять ActiveAssignment shape, Embassy UI/reward rules.

### 3.7. ExpeditionPool поверх expeditionDeck

**Файлы:** `random-sources.js`, `game-logic.js`, `server.js`, random-source/legendary/game-logic tests.

**Новый API:** `expeditionPool(room)`: `selectEligible(player)`, `reserve(id)`, `release(id)`, `availableCount()`.

**Adapter:** `room.expeditionDeck.drawPile` remains backing; active reservation отражается старым `player.activeExpedition`.

**Инварианты:** one active expedition/player; one entry cannot be active twice; player-history eligibility; skipped for one remains global; completion releases exactly once and restores random availability.

**Старые тесты:** expedition take/complete/history/restart/UI.

**Новые тесты:** two-player exclusivity; player-specific skip not global removal; exact release; recovery excludes active reservations.

**Commit boundary:** expedition source + take/complete paths.

**Нельзя:** менять task/history shape или treasure reward.

**CHECKPOINT B — полный GitHub review 3.5–3.7 и всех пяти stateful sources.**

### 3.8. Обсерватория, Посольство и Картограф поверх source operations

**Файлы:** `server.js`, `game-logic.js`, `random-sources.js`, Stage 6/server tests.

**Новый API usage:** Observatory → SailingEventSource reject/next; Embassy → AssignmentPool offer/choose/return; Cartographer → SeaEncounterSource peekNext.

**Adapters:** rule definitions/public payload names пока старые.

**Инварианты:** Observatory mandatory second; Embassy current eligibility exact; Cartographer peek equals next consume and не мутирует source.

**Старые тесты:** Observatory/Embassy/Cartographer.

**Новые тесты:** consumer trace asserts, что handlers больше не читают piles напрямую.

**Commit boundary:** только три consumers.

**Нельзя:** action costs, ranges, availability, UI semantics.

### 3.9. Treasure Hunter source operation

**Файлы:** `random-sources.js`, `game-logic.js` и tests. Player-facing pending/UI wiring можно оставить 5.8, если оно требует новой PendingResolution entity.

**Новый API:** `selectTreasureCandidates(2,rng)` = два независимых samples with replacement.

**Adapter:** никакого state/deck. Если безопасного pending container ещё нет, этот slice ограничивается domain operation + tests.

**Инварианты:** оба samples uniform/independent; одинаковые candidates допустимы; keep-one не меняет future distribution.

**Старые тесты:** treasure selectors.

**Новые тесты:** deterministic [A,A] допустимо; deterministic [A,D]; отсутствие distinct filter.

**Commit boundary:** pure operation и thin consumer call только если не требуется новый state shape.

**Нельзя:** distinct-selection, `treasureDeck`, изменение treasure outcomes.

**CHECKPOINT C — полный GitHub review блока 3.** Проверить отсутствие gameplay direct access к piles вне adapters/migrations, полный CI и неизменённый persisted shape.

## 4. Блок 4 — visibility

Блок 4 начинается только после отдельного авторского решения R29. Roadmap не заполняет матрицу вместо автора.

Главный security invariant: если opponent-private property не разрешено правилами, сервер вообще не включает его в payload этого клиента.

### 4.1. Зафиксировать author-approved visibility matrix

**Файлы:** документ/fixture видимости; runtime не менять.

**Выход:** entity/property × owner/opponent/Scout/pending actor/public observer.

**Adapter:** текущий `publicRoom` остаётся.

**Тесты:** coverage test, что privacy-sensitive entity types перечислены.

**Commit:** approved matrix + fixture only.

**Нельзя:** самостоятельно заполнять спорные клетки.

**GATE:** без принятого 4.1 не выполнять 4.2–4.7.

### 4.2. Projection policy engine deny-by-default

**Файлы:** новый `state-projection.js`, `server.js`, новый `test/visibility.test.js`.

**API:** `projectRoomForViewer(room,viewerContext)` и entity-specific projectors.

**Adapter:** сначала engine может сравниваться с current `publicRoom` в test mode; production payload не менять.

**Инварианты:** no mutation; deterministic per viewer; unknown private field не проходит автоматически.

**Новые тесты:** pure projection fixtures owner/opponent/null viewer.

**Commit:** framework only.

### 4.3. Opponent/public filtering

**Файлы:** state-projection/server/tests.

**Switch:** opponent-facing player/task/ability/benefit/pending state на approved matrix.

**Adapter:** owner path пока legacy.

**Инвариант:** запрещённые properties отсутствуют целиком, а не отправляются null/hidden.

**Tests:** key-absence tests для нескольких roles.

**Commit:** opponent/public paths only.

### 4.4. Owner projection

**Файлы:** state-projection/server/tests/client contract.

**Switch:** owner тоже получает explicit whitelist, не raw state.

**Инварианты:** owner имеет достаточно данных для UI/actions; чужие secrets не протекают через nested source/pending objects.

**Tests:** owner snapshots/action options.

**Commit:** owner path.

**CHECKPOINT D — полный security review до Scout.**

### 4.5. Scout temporary reveal

**Файлы:** state-projection, server, game-logic/domain-state, public app, visibility/server tests.

**API:** viewer-scoped temporary reveal grants строго по approved R29.

**Adapter:** current `player.character` может оставаться.

**Инварианты:** Scout не мутирует скрытую entity; reveal scope/range/duration exact; другие viewers ничего лишнего не получают.

**Tests:** in/out of range, expiry, unrelated opponent unchanged.

**Commit:** Scout only.

### 4.6. Reconnect/save behavior reveal state

**Файлы:** reconnect/server, room-store tests, visibility tests.

**Инварианты:** reconnect не продлевает и не обнуляет reveal раньше правила; projection пересчитывается server-side.

**Adapter:** raw save ещё pre-block-6 shape.

**Commit:** reconnect/persistence behavior only.

### 4.7. Two-client security regression suite

**Файлы:** visibility/socket integration tests.

**Tests:** два real clients плюс при необходимости admin/public viewer; exact absence/presence sensitive keys для task, abilities, stored benefits, pending, Scout reveal, reconnect.

**Commit:** tests/fixes only, без новой policy semantics.

**CHECKPOINT E — полный GitHub security review блока 4.**

## 5. Блок 5 — internal model cleanup

Принцип: consumers переходят на digital domain facades, но до блока 6 old persisted fields остаются backing storage. Никакого второго authoritative state.

### 5.1. Domain facade foundation

**Файлы:** новый `domain-state.js`, `game-logic.js`, новый `test/domain-state.test.js`.

**API:** factories/accessors Task, ConsumableAbility, StoredBenefit, Discovery, TemporaryEffect, PendingResolution, HistoryRecord.

**Adapter:** wrapping old fields only.

**Инвариант:** read/write round-trip через facade не меняет room JSON shape.

**Commit:** foundation only.

### 5.2. ActiveAssignmentTask facade

**Файлы:** domain-state, game-logic/server, assignment tests.

**API:** `getActiveAssignmentTask`, `assignTask`, `completeAssignmentTask`.

**Adapter:** backing `player.activeAssignment.card`.

**Инварианты:** instanceId/progress/reward/linkage identical; assignment never enters held inventory.

**Commit:** assignment consumers only.

### 5.3. ActiveExpeditionTask + history/usage facade

**Файлы:** domain-state, game-logic/server, expedition tests/UI contract.

**Adapter:** old active/history/round/count fields.

**Инварианты:** leave-return, pool reservation/release, per-round limit, history eligibility.

**Commit:** expedition model only.

### 5.4. ConsumableAbilities facade

**Файлы:** domain-state, game-logic/server, legendary tests.

**API:** list/grant/consume ability.

**Adapter:** reads/writes `legendaryCards` + `specialCards`; runtime refs stable enough for actions, save shape unchanged.

**Инварианты:** duplicates; exact reactions; origins; random held candidate count.

**Commit:** abilities only.

### 5.5. StoredBenefits facade

**Файлы:** domain-state, sailing source adapter, saved-event server handlers/tests.

**API:** store/consume/discard benefit + source reservation link.

**Adapter:** backing `savedEventCards/sourceCard`.

**Инварианты:** reserved occurrence released exactly once; use conditions/action costs unchanged; legacy treasure-cargo linkage kept.

**Commit:** stored benefits only.

**CHECKPOINT F — полный GitHub review task/inventory facades.**

### 5.6. Discovery model

**Файлы:** domain-state, game-logic/server, scoring/UI tests.

**API:** claim/get discoveries; player discoveries derived.

**Adapter:** `legendaryPlacesExplored` authoritative; `namedPlaceCards` compatibility mirror.

**Инварианты:** exactly-once reward; public ownership/count/scoring unchanged.

**Commit:** discoveries only.

### 5.7. TemporaryEffect model

**Файлы:** domain-state, game-logic/server, effect tests.

**API:** typed add/query/tick/remove player/island effects.

**Adapter:** activeTurnEffects, legendaryEffects, legendaryVeil* backing. `nextTurnEffects` legacy untouched.

**Инварианты:** timing, stacking, source, reaction expiry, restart.

**Commit:** effects only.

### 5.8. Unified PendingResolution facade

**Файлы:** domain-state, server/game-logic, event/feud/legendary/assignment tests.

**API:** tagged variants over current four pending fields.

**Adapter:** physical fields remain separate until block 6.

**Инварианты:** no redraw/reselection on resume; actor/options exact/private; continuation exact.

**Treasure Hunter:** если 3.9 не сделал player-facing choice, здесь добавить `PendingResolution.TreasureChoice` с двумя уже sampled candidates; они могут совпасть.

**Commit:** pending facade + Treasure Hunter choice only if needed.

### 5.9. ResolutionQueue facade

**Файлы:** domain-state, expedition reward drain, tests.

**API:** FIFO enqueue/drain.

**Adapter:** `pendingExpeditionRewards`.

**Инварианты:** FIFO; pause on pending; resume once; assignment linkage.

**Commit:** queue only.

### 5.10. PreTurnResolutionFlow facade

**Файлы:** domain-state, server event orchestration, party-clock tests.

**API:** explicit sailing → political → assignment stages.

**Adapter:** `eventPhase` backing.

**Инварианты:** turn/round ordering, indexes, Observatory counter, restart resume.

**Commit:** orchestration only.

### 5.11. Static definition naming cleanup

**Файлы:** `rules/runtime.js`, `game-data.js`, consumers/tests.

**Semantic exports:** SEA_ENCOUNTER_DEFINITIONS, SAILING_EVENT_DEFINITIONS, POLITICAL_EFFECT_DEFINITIONS, ASSIGNMENT_DEFINITIONS, EXPEDITION_DEFINITIONS, TREASURE_OUTCOME_DEFINITIONS, CONSUMABLE_ABILITY_DEFINITIONS, PLACE_DISCOVERY_DEFINITIONS.

**Adapter:** old `*_CARDS` exports remain aliases until migration/deprecation.

**Инвариант:** identity/order/quantity/effects unchanged.

**Commit:** aliases/import cleanup only.

**CHECKPOINT G — полный GitHub review блока 5.**

## 6. Блок 6 — save migration

До этого блока persisted snapshots остаются старой shape.

### 6.1. Schema/version marker и migration dispatcher

**Файлы:** новый `save-migrations.js`, `room-store.js`/server init, новый `test/save-migration.test.js`.

**API:** `migrateRoomState(rawRoom) -> {state,migrated,fromVersion,toVersion}`.

**Marker:** отдельный digital model schema version, не ruleset version.

**Инварианты:** pure/idempotent; old loads; already-new no-op.

**Commit:** version/dispatcher only.

### 6.2. SeaEncounter/SailingEvent/PoliticalEffect source migration

**Transform:** old draw/discard → new source representation.

**Критический инвариант:** exact next outcome сохраняется; remaining order не reshuffle. Used/recyclable multiset переносится отдельно. Sailing reservation не теряется.

**Tests:** known-next fixtures, partially spent cycle, empty draw/non-empty discard, pending/held event.

**Commit:** только три source types.

### 6.3. AssignmentPool migration

**Transform:** draw/discard/removed → available order/recyclable/permanentlyExcluded; active/pending candidates reserved.

**Инварианты:** same next eligible stream; skip semantics; removed never returns.

**Tests:** active assignment, Embassy pending, remove/skip.

**Commit:** assignment source only.

### 6.4. ExpeditionPool + task/history/usage migration

**Transform:** expedition draw pile → available pool; active/history/usage → target fields.

**Инварианты:** active not duplicated; next eligible preserved from old order; completion releases once.

**Tests:** multiple players, different histories, startedAtTarget.

**Commit:** expedition only.

**CHECKPOINT H — полный GitHub review source migrations.**

### 6.5. Active assignments, abilities и stored benefits migration

**Transform:** activeAssignment → task; legendaryCards+specialCards → abilities with ids/origin; savedEventCards → benefits + reservation link.

**Инварианты:** counts/effects/linkages; random held candidate set; event reservation.

**Tests:** duplicates, reactions, legacy special string, treasure-cargo linkage.

**Commit:** player task/inventory only.

### 6.6. Discoveries и temporary effects migration

**Transform:** discovery registry target records; namedPlace duplicate becomes derived; effects to typed state; nextTurnEffects → scheduled compatibility effect.

**Инварианты:** no reward replay; duration/timing not reset.

**Tests:** mid-effect restart, stacked curse, island veil/reaction, legacy next-turn event.

**Commit:** discoveries/effects only.

### 6.7. Pending resolutions, resolutionQueue и pre-turn flow migration

**Transform:** current pending fields/eventPhase/pendingExpeditionRewards → target tagged state.

**Инварианты:** selected random result/task preserved; zero extra RNG calls; actor/options/index/continuation exact; FIFO.

**Tests:** fixture each pending variant and each flow stage.

**Commit:** pending/orchestration only.

### 6.8. Legacy-only cleanup migration

**Remove after successful conversion:** treasureDeck, legendaryDeck, pendingLegendary, consumed masterCardId payloads, replacedAssignmentConditions, assignment-replace stage, invalid old expedition entries and proven-consumed compatibility fields.

**Инвариант:** cleanup only after target exists; legacy fields no longer affect gameplay.

**Tests:** fixture per retired field.

**Commit:** cleanup only.

### 6.9. Idempotence/double-reload matrix

Для каждого fixture: old load → migrate → save → reload → migrate again → assert target state stable and same next random outcomes.

Покрыть oldest supported, mid-Stage-6, current pre-refactor and already-migrated saves.

**Commit:** tests + fixes only.

### 6.10. Persisted cutover и удаление legacy runtime writers

**Switch:** new rooms write only new schema; migrated rooms resave new shape; old-read migration remains.

**Инварианты:** no dual authoritative storage; old save migrates once; new save never backslides; restart/reconnect green.

**Commit:** final storage cutover only.

**Нельзя:** удалять old-read migration в том же commit.

**CHECKPOINT I — финальный полный GitHub review блока 6.**

## 7. Dependency graph

Random sources:
- `3.1 → 3.2`
- `3.1 → 3.3 → 3.8`
- `3.1 → 3.4 → 3.8`
- `3.1 → 3.5`
- `3.1 → 3.6 → 3.8`
- `3.1 → 3.7`
- `3.2 → 3.9`
- `3.3+3.4+3.5+3.6+3.7+3.8+3.9 → CHECKPOINT C`

Visibility:
- `author R29 → 4.1 → 4.2 → 4.3 → 4.4 → 4.5 → 4.6 → 4.7`

Internal model:
- `CHECKPOINT C → 5.1`
- `5.1 → 5.2, 5.3, 5.4`
- `3.4 + 5.1 → 5.5`
- `5.1 → 5.6, 5.7`
- `5.1 + source APIs → 5.8 → 5.9 → 5.10`
- `5.2…5.10 → 5.11`

Recommended sequencing: finish block 4 before final block-5 cleanup so projection tests target stable semantic entity names. Block 3 is not blocked by R29.

Save migration:
- `CHECKPOINT E + CHECKPOINT G → 6.1`
- `6.1 + block-3 APIs → 6.2 → 6.3 → 6.4`
- `6.1 + block-5 facades → 6.5 → 6.6 → 6.7`
- `6.2…6.7 → 6.8 → 6.9 → 6.10`

Hard gates:
- R29 blocks 4.1+, not block 3.
- No block-6 cutover before block-5 facades.
- No legacy field deletion before its migration test.
- No source storage migration before deterministic trace tests.

## 8. Rollback strategy

1. Один slice = один logical commit.
2. Source API сначала работает поверх old storage. Revert возвращает прежний runtime без data conversion.
3. Consumer switch не удаляет adapter в том же commit.
4. Visibility переводится projection-by-projection; legacy projection helper не удалять до CHECKPOINT E.
5. Domain facade не создаёт второй authoritative store: до 6.10 пишет old backing, после cutover — new backing.
6. Save migration не удаляет old reader в том же commit.
7. Каждый migration имеет old→new fixture и idempotence assertion.
8. Нельзя коммитить состояние, где producer пишет new shape, а consumer читает old shape без adapter, или наоборот.
9. Перед каждым checkpoint контролирующий чат делает полный GitHub diff review от предыдущего checkpoint, а не только последнего commit.

## 9. Проверки каждого implementation slice

Минимум:
- `npm run check`;
- `npm test`;
- `npm run test:data`;
- targeted tests slice;
- GitHub Actions green;
- parent→commit diff ограничен заявленным scope.

Дополнительно:
- random sources: deterministic sequence/trace;
- visibility: key-absence with two viewers;
- internal model: old backing JSON round-trip until block 6;
- migration: old→new + reload + second migration no-op.

## 10. Рекомендуемая последовательность будущих команд

### Блок 3 — 9 slices

**3.1** Contracts digital random sources + deterministic harness.  
**3.2** Stateless TreasureOutcomeSource/LegendaryAbilitySource + wrappers.  
**3.3** SeaEncounterSource поверх anchorDecks.  
**3.4** SailingEventSource с reservation semantics поверх eventDeck.  
**CHECKPOINT A — review 3.1–3.4.**  
**3.5** PoliticalEffectSource поверх feudDecks.  
**3.6** AssignmentPool поверх assignmentDecks.  
**3.7** ExpeditionPool поверх expeditionDeck.  
**CHECKPOINT B — review 3.5–3.7 и всех five sources.**  
**3.8** Observatory/Embassy/Cartographer → source operations.  
**3.9** Treasure Hunter operation: два independent samples, duplicates allowed.  
**CHECKPOINT C — review блока 3.**

### Блок 4 — 7 slices

**4.1** После авторского решения зафиксировать visibility matrix.  
**4.2** Deny-by-default projection engine без production switch.  
**4.3** Opponent/public filtering.  
**4.4** Owner projection.  
**CHECKPOINT D — security review.**  
**4.5** Scout temporary reveal.  
**4.6** Reconnect/save semantics reveal state.  
**4.7** Two-client security regression suite.  
**CHECKPOINT E — review блока 4.**

### Блок 5 — 11 slices

**5.1** Domain-state facade foundation.  
**5.2** ActiveAssignmentTask facade.  
**5.3** ActiveExpeditionTask + history/usage facade.  
**5.4** ConsumableAbilities facade.  
**5.5** StoredBenefits facade + event reservation link.  
**CHECKPOINT F — review task/inventory facades.**  
**5.6** Discovery model.  
**5.7** TemporaryEffect model.  
**5.8** Unified PendingResolution facade; при необходимости Treasure Hunter choice wiring.  
**5.9** ResolutionQueue facade.  
**5.10** PreTurnResolutionFlow facade.  
**5.11** Semantic static-definition aliases/import cleanup.  
**CHECKPOINT G — review блока 5.**

### Блок 6 — 10 slices

**6.1** Digital model schema version + idempotent dispatcher.  
**6.2** Migrate SeaEncounter/SailingEvent/PoliticalEffect state preserving next outcome.  
**6.3** Migrate AssignmentPool + reservations.  
**6.4** Migrate ExpeditionPool + active/history/usage.  
**CHECKPOINT H — review source migrations.**  
**6.5** Migrate active assignments, abilities, stored benefits.  
**6.6** Migrate discoveries, temporary effects, nextTurnEffects.  
**6.7** Migrate pending resolutions, resolutionQueue, pre-turn flow.  
**6.8** Cleanup migration legacy-only fields including treasureDeck/legendaryDeck.  
**6.9** Idempotence/double-reload fixture matrix.  
**6.10** Persisted cutover; remove legacy writers, retain old-read migration.  
**CHECKPOINT I — final review блока 6.**

## 11. Количество slices

- Блок 3: **9**.
- Блок 4: **7**.
- Блок 5: **11**.
- Блок 6: **10**.
- Всего: **37 implementation slices**.
- Full GitHub checkpoints: **9** — A–I.

## 12. Финальная сверка

Roadmap покрывает все пять stateful source из аудита, оба stateless digital source, consumers Обсерватории/Посольства/Картографа/Искателя, active tasks/history/usage, abilities/stored benefits, discoveries, temporary effects, pending state и legacy migration.

Ни один инвариант mapping не отменён. Уточнение Искателя внесено в mapping: два candidate результата — независимые selection with replacement, совпадение допустимо. Единственный оставшийся authorial gate — R29/Разведчик перед блоком 4.

Roadmap не требует big-bang замены и не допускает промежуточного commit без явного adapter layer.
