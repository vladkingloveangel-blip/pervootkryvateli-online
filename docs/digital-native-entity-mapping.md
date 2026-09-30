# Блок 2 — целевая цифровая модель карточных сущностей

Дата проектирования: 2026-09-30  
Ветка: `digital-native/refactor`  
Основание: `docs/digital-native-card-deck-audit.md`  
Исходный HEAD шага 2: `ee1e5d240bfe3ea1a705e3c37c7665f4a2180280`

## 1. Граница шага

Этот документ является архитектурным проектом. Он не меняет runtime-код, состояние комнаты, save format, правила, вероятности, порядок разрешения механик или клиентскую видимость.

Цель — отделить настоящие игровые сущности мобильной игры от физической терминологии настольных компонентов. Слова `card`, `deck`, `drawPile` и `discard` могут оставаться в исходных данных и legacy-совместимости до следующих блоков, но не должны определять целевую доменную модель.

Дальнейшие блоки:
- **3 — random sources:** цифровые источники случайности и их семантика;
- **4 — visibility:** серверная видимость, R29 и приватные projections;
- **5 — internal model cleanup:** задачи, способности, эффекты, открытия и pending resolution;
- **6 — save migration:** смена persisted shape, удаление legacy-полей и миграция старых JSONB.

Блок 3 может вводить новые source API поверх текущего persisted state. Блок 5 может нормализовать внутренние типы. Физически переименовывать или удалять persisted поля безопасно только в блоке 6.

## 2. Целевая таксономия

В целевой модели нет универсальной сущности «карта». Вместо неё используются:

1. **RandomSource** — источник случайного результата с явно заданной памятью прошлых результатов.
2. **Task** — принятая игроком задача с условиями, прогрессом и завершением.
3. **ConsumableAbility** — одноразовая способность игрока.
4. **StoredBenefit** — отложенный игровой результат, применяемый позже.
5. **TemporaryEffect** — уже активированный эффект с областью действия и сроком.
6. **Discovery** — факт первого открытия/достижения.
7. **PendingResolution** — незавершённое обязательное решение или state machine.
8. **HistoryRecord** — завершённый факт, нужный правилам/интерфейсу.
9. **StaticRuleDefinition** — каноническое описание результата, задачи или способности.
10. **LegacyOnly** — данные только для чтения/миграции старых сохранений.
11. **PresentationOnly** — UI-карточка без доменной карточной семантики.

## 3. Семантика цифровых random sources

Это не описание реализации. Внутри источник может использовать массивы, bag, permutation, индексы или иной алгоритм, если наблюдаемое поведение совпадает с указанной семантикой.

### 3.1. Independent random with replacement

Каждый запрос независим. Предыдущий результат не меняет вероятность следующего. Один тип может выпадать сколько угодно раз подряд. Persisted gameplay state источнику не нужен.

Используется для сокровищ и случайных легендарных наград.

### 3.2. Random cycle without replacement

Источник имеет цикл с фиксированным мультимножеством результатов. Внутри цикла уже использованный экземпляр не может появиться снова до обновления цикла. После завершения цикла все разрешённые к возврату occurrences снова доступны.

Используется для политических эффектов вражды и является базой событий/морских встреч.

### 3.3. Ordered/cyclic source with stable peek

Это cycle without replacement, но существует наблюдаемое понятие **следующего результата**. Peek возвращает ровно тот результат, который будет потреблён следующим, если между peek и consume никто не изменил источник.

Используется для морских встреч из-за Картографа.

### 3.4. Reservable cyclic source

Outcome occurrence может быть временно изъят из цикла и удерживаться игроком. Пока occurrence зарезервирован, он не возвращается в доступность.

Используется для событий плавания, сохраняемых через текущий `savedEventCards`.

### 3.5. Filtered task pool

Task source различает:
- **eligible** — можно выдать;
- **skip** — временно не подходит конкретному игроку, но остаётся в pool;
- **remove** — навсегда исключается из текущей партии;
- **reserved** — выдан как active task;
- **recyclable** — завершён/отменён и может вернуться в будущий цикл.

Используется для поручений.

### 3.6. Reservable random pool

Доступный элемент выбирается случайно, затем резервируется активной задачей и исключается из общего pool. После завершения возвращается. Eligibility может зависеть от истории конкретного игрока.

Используется для экспедиций.

## 4. Stateful random sources

### 4.1. `room.anchorDecks` → `room.seaEncounterSources`

**Смысл:** три цифровых источника морских встреч по цветам якорей.

**Целевой тип:** `SeaEncounterSource`.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** gameplay state + random source.  
**Семантика:** ordered/cyclic source with stable peek.

Обязательная механика:
- отдельный цикл blue/yellow/red;
- каждый цикл содержит 10 occurrences с текущими multiplicities из `rules/sea.json`;
- вероятность первого outcome типа равна `quantity / 10`, далее действует without replacement по оставшимся occurrences;
- использованный occurrence не возвращается до обновления цикла;
- Картограф в текущем радиусе может увидеть стабильный next outcome;
- peek не потребляет и не меняет next outcome;
- `visitedAnchors`, action cost, combat outcome, награды/штрафы и assignment trigger `anchor-win` остаются отдельной механикой.

Убрать физическую семантику: `drawPile`, `discard`, «верхняя карта» и «сброс» как доменные зоны. Сохранить цифровые понятия current cycle, remaining occurrences и next outcome.

Зависимости: encounter resolution, Картограф, assignments, public source counters, `visitedAnchors`, `lastAnchorEncounter`.

Безопасные блоки: 3 → 4/5 → 6.

### 4.2. `room.eventDeck` → `room.sailingEventSource`

**Смысл:** цифровой источник событий плавания шестого круга.

**Целевой тип:** `SailingEventSource`.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** gameplay state + random source.  
**Семантика:** reservable random cycle without replacement.

Обязательная механика:
- цикл из 26 occurrences с текущими multiplicities `rules/events.json`;
- первый outcome имеет вероятность `quantity / 26`, далее тот же occurrence не повторяется до возврата/нового цикла;
- обычный resolved outcome считается использованным;
- сохранённый outcome остаётся зарезервированным до use/discard;
- Обсерватория может принять первый outcome либо отклонить его без применения и обязательно запросить второй;
- отклонённый первый outcome уже использован в текущем цикле;
- pending resolution переживает restart без повторного random selection;
- legacy canonicalization старых `id/masterCardId` остаётся до миграции.

Убрать: domain-level `drawPile/discard`. Сохранить семантику remaining/used/reserved occurrences.

Зависимости: Обсерватория, `savedEventCards`, `eventPhase`, `pendingEvent`, temporary effects, treasure/legendary sources.

Безопасные блоки: 3 → 5 → 6.

### 4.3. `room.feudDecks` → `room.politicalEffectSources`

**Смысл:** отдельный цифровой циклический источник политического эффекта каждой фракции.

**Целевой тип:** `PoliticalEffectSource` keyed by `factionId`.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** gameplay state + random source.  
**Семантика:** random cycle without replacement.

Обязательная механика:
- отдельный десяти-occurrence cycle на faction;
- multiplicities из `rules/events.json:feud` задают состав и текущие вероятности;
- occurrence не повторяется до cycle refresh;
- pending choice хранит уже выбранный effect и после restart не выбирает новый;
- legacy `masterCardId` mapping действует до migration.

Убрать: `drawPile/discard` и «карта вражды» как тип runtime-сущности.

Зависимости: political queue, `pendingFeud`, random held discard и конкретные effect handlers.

Безопасные блоки: 3 → 5 → 6.

### 4.4. `room.assignmentDecks` → `room.assignmentPools`

**Смысл:** stateful pools задач каждого сюзерена.

**Целевой тип:** `AssignmentPool`.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** gameplay state + random/task source.  
**Семантика:** filtered pool with temporary skip, permanent removal and recyclable tasks.

Обязательная механика:
- отдельный pool lionia/kadingir/mori/suniksiya/pirates; Mayo без assignment source;
- eligibility вычисляется при выдаче;
- `skip` не удаляет task;
- `remove` исключает task из текущей партии;
- active assignment резервирует task;
- completed/cancelled task возвращается в recyclable часть согласно текущему циклу;
- Посольство получает до двух eligible candidates; выбранный резервируется, невыбранный возвращается;
- если eligible только один, второй не выдумывается;
- `instanceId` и progress сохраняются для assignment-specific событий.

Убрать: физические зоны `drawPile/discard/removed`. Сохранить их логический смысл как available/recyclable/permanently excluded/reserved.

Зависимости: `activeAssignment`, Embassy, assignment queue, Mori progress, cargo/treasure linkage.

Безопасные блоки: 3 → 5 → 6.

### 4.5. `room.expeditionDeck` → `room.expeditionPool`

**Смысл:** общий reservable pool доступных экспедиций.

**Целевой тип:** `ExpeditionPool`.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** gameplay state + random/task source.  
**Семантика:** reservable random pool with player-specific eligibility.

Обязательная механика:
- семь canonical expedition definitions;
- один player не может иметь более одной active expedition;
- один pool entry не может одновременно быть available и active;
- eligibility исключает уже завершённое данным player место в пределах current completion limit;
- skipped для одного player expedition остаётся доступной другим;
- accepted expedition резервируется;
- completed expedition возвращается в общий pool и снова участвует в случайной выдаче;
- per-round access limit и наличие Картографической палаты остаются отдельными access rules.

Убрать: `drawPile` и «колоду». Сохранить эксклюзивную reservation semantics.

Зависимости: `activeExpedition`, history, usage counters, cartography building, expedition reward queue.

Безопасные блоки: 3 → 5 → 6.

## 5. Stateless digital random sources

### 5.1. `TREASURE_CARDS + BALANCE.treasurePool` → `TreasureOutcomeSource`

**Смысл:** цифровой генератор результата сокровища.

Отдельная persisted runtime-сущность не нужна. Целевая операция: `selectTreasureOutcome()` над static definitions.

**Владелец:** static rules/service.  
**Persistence:** нет.  
**Класс:** random source + static rules.  
**Семантика:** independent uniform random with replacement.

Инварианты:
- четыре canonical outcome types;
- 25% каждый;
- каждый selection независим;
- одинаковые outcomes могут выпадать подряд;
- прошлый outcome ничего не расходует;
- нет discard/reshuffle/copy count.

Зависимости: sailing treasure event, expedition reward, assignment `treasure-resolved`, Treasure Hunter.

Блок: 3. Legacy `treasureDeck` — только 6.

### 5.2. `LEGENDARY_CARDS + BALANCE.legendaryPool` → `LegendaryAbilitySource`

**Смысл:** цифровой генератор экземпляра одноразовой легендарной способности.

Persisted source object не нужен. Целевая операция: `selectLegendaryAbility()`.

**Владелец:** static rules/service.  
**Persistence:** нет.  
**Класс:** random source + static ability definitions.  
**Семантика:** independent uniform random with replacement.

Инварианты:
- четыре typeIds;
- каждый grant независим;
- одинаковый type может выпадать подряд и существовать у игрока в нескольких экземплярах;
- consumption не влияет на вероятность future grants;
- physical `legendaryDeck` не возвращается.

Зависимости: consumable abilities, discoveries, island rewards, sailing legendary event.

Блок: 3. Legacy migration — 6.

## 6. Задачи и история

### 6.1. `player.activeAssignment` → `ActiveAssignmentTask`

**Смысл:** активная задача сюзерена.  
**Должна существовать:** да, отдельно от inventory/hand.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** task + gameplay state.

Целевой type shape: `{ instanceId, definitionId, factionId, issuedRound, progress }`. После migration полное static rule body не обязано дублироваться в save.

Сохранить: instance identity, faction, issued round, Mori progress, assignment-specific linkage, complete/cancel release в pool.

Убрать: вложенное `card` как основную доменную сущность и смешение active task с «рукой».

Зависимости: assignment pool, tracking, cargo metadata, UI, assignment priority.

Блок: 5; visibility — 4; persisted shape — 6.

### 6.2. `player.activeExpedition` → `ActiveExpeditionTask`

**Смысл:** принятая expedition task.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** task + gameplay state.

Целевой shape: `{ expeditionId, placeId, acceptedRound, startedAtTarget, departedAfterIssue }`.

Сохранить: pool reservation, target, leave-and-return, round, reward trigger.

Убрать: вложенную physical `card` copy; static definition разрешать по id.

Блок: 5 → 6.

### 6.3. `player.expeditionHistory` → `player.expeditionCompletions`

**Смысл:** history/registry завершённых экспедиций и источник eligibility.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** history + gameplay state.

Сохранить: place/expedition identity, completed round, completion count semantics per place.

Убрать: physical card identity как обязательный смысл.

Блок: 5; visibility — 4; migration — 6.

### 6.4. `expeditionDrawRound + expeditionsDrawnThisRound` → `expeditionAccessUsage`

**Смысл:** per-player usage counter лимита получения expedition.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** gameplay state.

Сохранить current `drawsPerRound` semantics.

Блок: 5 → 6.

## 7. Одноразовые способности и сохранённые результаты

### 7.1. `player.legendaryCards + player.specialCards` → `player.consumableAbilities`

**Смысл:** принадлежащие player одноразовые ability instances.

**Целевой тип:** `ConsumableAbilityInstance { instanceId, abilityId, origin }`.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** ability/inventory gameplay state.

Сохранить:
- несколько одинаковых ability instances допустимы;
- каждый экземпляр расходуется независимо;
- hostile ability может открыть reaction window;
- Sea Veil может применяться реактивно;
- random held discard может выбрать ability;
- fixed grants и random grants дают те же эффекты;
- origin сохраняется хотя бы на переходный период, чтобы не потерять существующие counts/legacy/UI-различия.

Убрать: строковые names как identity, physical-card semantics, `handIndex` как стабильный identity.

Блок: 5; visibility — 4; migration — 6.

### 7.2. `player.savedEventCards` → `player.storedBenefits`

**Смысл:** отложенные результаты события.

**Целевой тип:** `StoredBenefitInstance` с kind/definition и reservation identity исходного sailing occurrence.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** stored effect/item + gameplay state.

Сохранить:
- found cargo;
- Ship Master;
- blueprints;
- текущие action costs/conditions позднего применения;
- random held discard;
- пока benefit удерживается, исходный sailing occurrence остаётся зарезервированным;
- use/discard освобождает reservation в source;
- legacy treasure-cargo assignment linkage.

Убрать: `sourceDeck:'event'` и вложенный `sourceCard` как physical object. Их смысл выражать reservation/sourceOccurrence identity.

Блок: contract 3 + model 5 → migration 6; visibility — 4.

### 7.3. Концептуальная закрытая рука

Отдельная runtime-сущность `hand` не нужна.

Random held discard должен получать цифровой набор допустимых inventory entities:
- consumable abilities;
- stored benefits;
- **не** active assignment task.

Скрытость — политика блока 4, а не reason создавать physical hand.

## 8. Открытия и достижения

### 8.1. `room.legendaryPlacesExplored` → `room.placeDiscoveries`

**Смысл:** authoritative registry первого открытия.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** discovery + gameplay state.

Сохранить: exactly-once first discovery, discoveredBy, sea/island trigger differences, одноразовую associated reward.

Это уже почти digital-native; требуется только naming/record normalization.

Блок: 5; visibility — 4; persisted rename — 6.

### 8.2. `player.namedPlaceCards` → derived `player.discoveries`

**Смысл:** player-facing представление открытий.

В целевой модели отдельный persisted array не обязателен, потому что authoritative факт уже находится в room discovery registry. Player view может вычисляться из `room.placeDiscoveries` + static definitions.

**Владелец:** derived player view.  
**Persistence:** предпочтительно нет после migration.  
**Класс:** discovery/derived presentation.

Сохранить: публичную identity, ownership, counts/scoring.

Убрать: дублирование source of truth и physical `quantity`.

Блок: 5 + 4 → 6.

### 8.3. `NAMED_PLACE_CARDS` → `PLACE_DISCOVERY_DEFINITIONS`

Static rules, не runtime cards и не random source. `quantity:1` означает уникальность definition, не физический экземпляр.

Блок: 5 при терминологической нормализации.

## 9. Временные эффекты

### 9.1. `player.activeTurnEffects` → `player.temporaryEffects.currentTurn`

**Смысл:** эффекты текущего персонального хода.  
**Владелец:** player.  
**Persistence:** да.  
**Класс:** temporary effect + gameplay state.

Сохранить: move bonus/penalty, best-of-two, no-navigation, no-income и exact current-turn timing.

Убрать: зависимость от card shape после resolution.

Блок: 5 → 6.

### 9.2. `player.nextTurnEffects`

Сегодня это compatibility buffer старого timing, а не основной modern event path.

**Целевая сущность:** отдельное постоянное поле не требуется. Старые значения при migration должны стать scheduled `TemporaryEffect` либо доигрываться compatibility adapter.

**Класс:** legacy-only/scheduled stored effect.  
**Persistence:** пока существуют старые saves.

Блок: 6. До него не удалять.

### 9.3. `player.legendaryEffects` → `player.temporaryEffects`

**Смысл:** длительные typed effects на player.  
**Persistence:** да.  
**Класс:** stored effect/gameplay state.

Целевой `TemporaryEffectInstance` хранит effectId, sourcePlayerId, duration/remaining и expiry rule.

Сохранить: durations, stacking sea curses, source, tick rules, reaction expiry.

Убрать: «legendary card state» после того, как ability уже consumed.

Блок: 5 → 6.

### 9.4. `island.legendaryVeil / island.legendaryVeilReaction` → `island.temporaryEffects`

**Смысл:** длительная или реактивная временная защита острова.  
**Владелец:** island.  
**Persistence:** да.  
**Класс:** stored effect/gameplay state.

Сохранить: duration, sourcePlayerId, reaction expiry.

Убрать: отдельные special-purpose fields, если общий typed effect container выражает те же правила.

Блок: 5; visibility — 4; migration — 6.

## 10. Pending resolution и orchestration

### 10.1. `room.eventPhase / eventPhase.lastCard` → `room.preTurnResolutionFlow`

**Смысл:** state machine обязательной последовательности шестого круга.  
**Владелец:** room.  
**Persistence:** да.  
**Класс:** pending resolution/gameplay state.

Сохранить: exact sailing → feud → assignment order, current actor/index/stage, Observatory limit, last outcome, restart resume.

Убрать: `lastCard` как generic physical-card object; хранить reference на outcome/task/effect.

Блок: 5 → 6.

### 10.2. `room.pendingEvent` → `PendingResolution` variants

**Смысл:** обязательный выбор по sailing event либо cargo reward.  
**Persistence:** да.  
**Класс:** pending resolution.

Целевые variants: `EventDecision` / `CargoPlacementDecision`.

Сохранить: actor, origin, selected source occurrence/outcome, options, exact continuation. Restart не делает новый random draw.

Блок: 5; visibility — 4; migration — 6.

### 10.3. `room.pendingFeud` → `PendingResolution.PoliticalEffectDecision`

Сохранить: faction, effect identity, remaining multi-step choices, excluded options и continuation. Уже выбранный effect не переопределяется.

Блок: 5 + 4 → 6.

### 10.4. `room.pendingAssignmentChoice` → `PendingResolution.AssignmentChoice`

Сохранить: reserved candidates, faction, actor; выбор одного и возврат остальных в pool.

Блок: pool contract 3 + model 5 + visibility 4 → migration 6.

### 10.5. `room.pendingLegendaryReaction` → `PendingResolution.AbilityReaction`

Сохранить: source/target/island, hostile ability identity, eligible reaction abilities, expiry и exact consume behavior.

Блок: 5 + 4 → 6.

### 10.6. `room.pendingExpeditionRewards` → `room.resolutionQueue`

**Смысл:** FIFO очередь автоматических последствий expedition completion.  
**Persistence:** да.  
**Класс:** pending resolution queue.

Сохранить: FIFO, player, expedition identity/label, assignment linkage, pause when cargo choice opens a pending resolution, продолжение после ответа.

Блок: 5 → 6.

## 11. Остальные state и зависимости аудита

### 11.1. `player.visitedAnchors`

Per-round encounter access state, не random source. Предотвращает повторный trigger на уже посещённой anchor cell.

Целевое имя возможно `visitedEncounterPointsThisRound`. Player-owned, persistent, gameplay state.

Блок: 5 → 6.

### 11.2. `player.lastAnchorEncounter`

History/telemetry последней морской встречи. На random distribution не влияет. До cleanup нужно проверить все consumers, затем оставить history record или сделать derived UI state.

Блок: 5 → 6.

### 11.3. `player.character` и `CHARACTERS`

Character — held one-use ability, выбираемая из static catalog по Admiralty access. `characterDeck` не существует и не нужен.

Player field остаётся ability ownership; catalog остаётся static rules.

Блок: 5; visibility — 4.

### 11.4. Обсерватория

Static building ability `replace-event`. Это операция над `SailingEventSource`: reject first outcome, mandatory second request.

Не отдельный random source.

Блок: 3 → 5.

### 11.5. Посольство

Static building ability `choose-assignment { draw:2, keep:1 }`. Это операция над `AssignmentPool`.

Блок: 3 → 5.

### 11.6. Картограф

Current effect `peek-sea-deck`. Целевой смысл: `peek-next-sea-encounter`.

Нужен stable non-consuming next API и приватная выдача результата использующему player.

Блок: 3 + 4 → 5.

### 11.7. Искатель сокровищ

Current effect `choose-treasure { draw:2, keep:1 }`. Целевой смысл: операция над `TreasureOutcomeSource`, не причина возвращать `treasureDeck`.

Архитектурный contract:
- получить два candidate outcomes из digital source;
- сохранить один;
- не создавать draw/discard state;
- actual source samples следуют canonical independent uniform random-with-replacement semantics.

Два candidate outcomes одного использования — два независимых selection из `TreasureOutcomeSource`; они могут совпасть. Distinct-selection запрещён. Ни операция, ни её UI не должны создавать `treasureDeck` или состояние draw/discard.

Блок: 3 + 5.

### 11.8. Разведчик

`inspect-hidden-cards` должен стать операцией visibility policy: просмотр разрешённых скрытых свойств ближайших цифровых сущностей.

Он не требует `hand` container и не определяет random-source architecture.

R29 → блок 4.

### 11.9. «Карточки островов»

`rules/islands.json` — static island definitions; `room.islands` — world entities. Island deck/runtime island card не нужен.

Блок 5 только при терминологической очистке.

### 11.10. Presentation-only `*-card`

CSS/DOM classes (`player-card`, `admin-room-card`, `map-info-card`, `legendary-card`, `named-place-card` и т.п.) — presentation-only. Они не участвуют в domain migration.

Косметически можно оставить и после блока 6.

## 12. Static rule definitions

Текущие каталоги остаются static rules, но их целевой смысл не physical cards:

| Сейчас | Целевой смысл |
| --- | --- |
| `ANCHOR_CARDS` | `SEA_ENCOUNTER_DEFINITIONS` + occurrence multiplicity per cycle |
| `SAILING_EVENT_CARDS` | `SAILING_EVENT_DEFINITIONS` + occurrence multiplicity per cycle |
| `FEUD_CARDS` | `POLITICAL_EFFECT_DEFINITIONS` + occurrence multiplicity per faction cycle |
| `ASSIGNMENT_CARDS` | `ASSIGNMENT_DEFINITIONS` |
| `EXPEDITION_CARDS` | `EXPEDITION_DEFINITIONS` |
| `TREASURE_CARDS` | `TREASURE_OUTCOME_DEFINITIONS` |
| `LEGENDARY_CARDS` | `CONSUMABLE_ABILITY_DEFINITIONS` |
| `NAMED_PLACE_CARDS` | `PLACE_DISCOVERY_DEFINITIONS` |

Для cyclic sources `quantity` нельзя просто удалить: оно кодирует реальную **occurrence multiplicity per cycle**. Целевое имя может стать `cycleMultiplicity` в блоке 5.

Для treasure/legendary copy quantities не нужны и не должны возвращаться.

## 13. Legacy-only данные

### `room.treasureDeck`
Migration-only inert data. Новый runtime source его не читает. Raw persisted field удалять только в блоке 6.

### `room.legendaryDeck`
Migration-only. Текущий normalizer уже удаляет live field, но чтение старых saves сохранять до блока 6.

### `player.pendingLegendary`
Migration-only counter → consumable ability instances через digital source.

### Старые sailing/feud objects с `masterCardId`
Compatibility input. До блока 6 canonicalization сохраняется; после migration persisted state ссылается на canonical ids.

### `replacedAssignmentConditions` и old `assignment-replace`
Legacy-only. Не возвращать в target model. Raw cleanup — блок 6.

### Старые expedition entries
Migration-only input; invalid old destinations продолжают фильтроваться до полной migration.

### `nextTurnEffects`
Compatibility-only scheduled effects old event timing. Не удалять до блока 6.

## 14. Классификация по масштабу изменения

### 14.1. Уже digital-native или почти digital-native

- TreasureOutcomeSource;
- LegendaryAbilitySource;
- `legendaryPlacesExplored` как discovery registry;
- temporary effects как состояние после consumption;
- expedition history;
- character ownership/catalog;
- island runtime entities.

### 14.2. В основном переименование/нормализация модели

- `activeAssignment` → task;
- `activeExpedition` → task;
- expedition history/usage;
- `legendaryCards + specialCards` → typed consumable abilities;
- `savedEventCards` → stored benefits;
- `namedPlaceCards` → derived discoveries;
- temporary effect fields → typed effect containers;
- pending fields → tagged pending resolution;
- `eventPhase` → pre-turn resolution flow.

### 14.3. Требуют настоящей смены алгоритмической абстракции

- `anchorDecks` → ordered cyclic source with stable peek;
- `eventDeck` → reservable cyclic event source;
- `feudDecks` → cyclic political-effect sources;
- `assignmentDecks` → filtered task pools;
- `expeditionDeck` → reservable random pool.

Их нельзя заменить independent random: это изменит вероятности и доступность.

### 14.4. Нельзя удалять до блока 6

- `treasureDeck`;
- `legendaryDeck`;
- `pendingLegendary`;
- old sailing/feud objects и `masterCardId`;
- `replacedAssignmentConditions`;
- old `assignment-replace` stage;
- old expedition entries;
- `nextTurnEffects` compatibility state;
- старые persisted `drawPile/discard/removed` формы stateful sources до полной save migration.

## 15. Инварианты для блока 3

1. Морские встречи: три independent color cycles, current multiplicities, without replacement, stable Cartographer peek.
2. События: occurrence не повторяется в current cycle; stored benefit резервирует occurrence; restart не делает redraw.
3. Обсерватория: reject first означает consume-without-apply; second обязателен и берётся из того же current cycle.
4. Вражда: каждый faction source сохраняет current ten-occurrence multiset и cycle refresh behavior.
5. Поручения: `eligible/skip/remove` различаются; Embassy до двух candidates, keep one, return rest; complete/cancel возвращает task в recyclable state.
6. Active assignment остаётся отдельной task entity, не hand item.
7. Экспедиция резервирует pool entry; два player не получают один active entry; completion возвращает entry; history влияет на eligibility.
8. Treasure: independent uniform 25% ×4 with replacement.
9. Legendary grants: independent uniform по четырём typeIds with replacement.
10. Treasure Hunter — operation over digital source, никогда не `treasureDeck`.
11. Scout — visibility/R29, не random-source problem.
12. До блока 6 old saves не теряют source state, reserved tasks, stored benefits или pending resolutions.

## 16. Места, требующие авторского решения

### 16.1. R29 — цифровая видимость и Разведчик

Формально открытый вопрос текущих правил. Не определено:
- какие свойства цифровых сущностей скрыты;
- что видит владелец;
- что видят остальные;
- какие свойства может раскрыть Разведчик;
- распространяется ли просмотр на active assignment, consumable abilities, stored benefits, pending choices и другие сущности;
- как долго сохраняется раскрытие.

Решение требуется перед блоком 4. Блок 3 оно не блокирует.

### 16.2. Искатель сокровищ — решение зафиксировано

Это больше не открытый вопрос. `choose-treasure { draw:2, keep:1 }` означает два независимых равновероятных selection из `TreasureOutcomeSource` с возвращением. Два предложенных outcome могут совпасть. Операция не использует distinct-selection и не создаёт `treasureDeck`.

Других новых авторских решений, необходимых для этого mapping, аудит шага 1 и текущие master rules не выявили.

## 17. Сводная таблица

| Текущая структура | Целевая сущность | Обязательные инварианты | Убрать физическую семантику? | Блок реализации |
| --- | --- | --- | --- | --- |
| `anchorDecks` | `seaEncounterSources / SeaEncounterSource` | 3 color cycles; multiplicities; without replacement; stable peek | Да, cycle/peek сохранить | 3 → 5 → 6 |
| `eventDeck` | `sailingEventSource` | 26-occurrence cycle; reservation; Observatory replace | Да, cycle/reservation сохранить | 3 → 5 → 6 |
| `feudDecks` | `politicalEffectSources` | 10-occurrence faction cycles; current multiplicities | Да | 3 → 5 → 6 |
| `assignmentDecks` | `assignmentPools` | eligibility; skip; remove; recycle; Embassy 2/keep1 | Да, логические states оставить | 3 → 5 → 6 |
| `activeAssignment` | `ActiveAssignmentTask` | instance/progress/linkage; не hand | Да | 5 → 4 → 6 |
| `expeditionDeck` | `expeditionPool` | reservable; player eligibility; return after completion | Да | 3 → 5 → 6 |
| `activeExpedition` | `ActiveExpeditionTask` | exclusivity, target, leave-return, reward trigger | Да | 5 → 6 |
| `expeditionHistory` | `expeditionCompletions` | history controls eligibility | Да | 5 → 4 → 6 |
| `expeditionDrawRound + expeditionsDrawnThisRound` | `expeditionAccessUsage` | per-round limit | Нет карточной семантики | 5 → 6 |
| `TREASURE_CARDS + treasurePool` | `TreasureOutcomeSource` | independent uniform 25% ×4 with replacement | Уже убрана | 3 |
| legacy `treasureDeck` | migration-only | не влияет на draws | Полностью | 6 |
| `LEGENDARY_CARDS + legendaryPool` | `LegendaryAbilitySource` | independent uniform with replacement | Уже убрана | 3 |
| legacy `legendaryDeck` | migration-only | не влияет на grants | Полностью | 6 |
| `legendaryCards` | `consumableAbilities` | duplicate instances; independent consumption | Да | 5 → 4 → 6 |
| `specialCards` | `consumableAbilities` with origin | fixed one-use grants | Да | 5 → 4 → 6 |
| `savedEventCards` | `storedBenefits` | delayed use; source occurrence reserved until release | Да | 3 contract + 5 → 6 |
| conceptual closed hand | visibility/inventory query | discard abilities+benefits, exclude assignment | Да, separate hand не нужен | 4 → 5 |
| `namedPlaceCards` | derived discoveries | public ownership/count/scoring | Да | 5 → 4 → 6 |
| `legendaryPlacesExplored` | `placeDiscoveries` | exactly-once first discovery | Нет, уже digital | 5 → 6 |
| `activeTurnEffects` | current-turn temporary effects | exact timing | Да | 5 → 6 |
| `nextTurnEffects` | legacy scheduled effects | old saves complete correctly | Да | 6 |
| `legendaryEffects` | player temporary effects | duration, stacking, source | Да | 5 → 6 |
| `legendaryVeil*` | island temporary effects | duration/reaction/source | Да | 5 → 4 → 6 |
| `eventPhase` | `preTurnResolutionFlow` | sailing→feud→assignment, resumable | Да | 5 → 6 |
| `pendingEvent` | pending resolution variant | no redraw on resume | Да | 5 → 4 → 6 |
| `pendingFeud` | political pending variant | selected effect preserved | Да | 5 → 4 → 6 |
| `pendingAssignmentChoice` | assignment choice variant | candidates reserved; rest returned | Да | 3 + 5 → 4 → 6 |
| `pendingLegendaryReaction` | ability reaction variant | source/target/consume exact | Да | 5 → 4 → 6 |
| `pendingExpeditionRewards` | `resolutionQueue` | FIFO, pause/resume, linkage | Да | 5 → 6 |
| `visitedAnchors` | encounter usage state | per-round duplicate prevention | Нет | 5 → 6 |
| `lastAnchorEncounter` | encounter history/telemetry | не влияет на probabilities | Нет | 5 → 6 |
| `player.character` | held character ability | unique access/use/consume | Нет deck semantics | 5 → 4 |
| Observatory | sailing source operation | reject first, mandatory second | Да | 3 → 5 |
| Embassy | assignment pool operation | up to 2 eligible, keep 1 | Да | 3 → 5 |
| Cartographer | peek-next encounter operation | stable non-consuming next | Да | 3 → 4 → 5 |
| Treasure Hunter | digital treasure choose operation | два независимых selection; совпадение допустимо; no deck | Да | 3 → 5 |
| Scout | visibility inspection ability | R29-defined properties | Да | 4 after R29 |
| island “cards” | static island definitions/world entities | map state unchanged | Да | 5 optional |
| CSS/DOM `*-card` | presentation-only | no gameplay meaning | Не требуется | post-6 cosmetic |

## 18. Сверка полноты с аудитом шага 1

Mapping повторно сверен с `docs/digital-native-card-deck-audit.md`. Учтены:
- пять stateful random/task sources;
- два stateless digital random sources;
- active assignment и expedition tasks;
- expedition history и usage counters;
- `legendaryCards`, `specialCards`, `savedEventCards` и conceptual closed hand;
- named-place discoveries и registry;
- current/legacy/legendary/island temporary effects;
- `eventPhase` и все пять pending/queue structures;
- Обсерватория, Посольство, Картограф, Искатель сокровищ, Разведчик;
- character ownership;
- anchor visit/history auxiliaries;
- static rule catalogs;
- island-card terminology;
- presentation-only card UI;
- все legacy structures, явно отмеченные аудитом.

На шаге 2 ни одна runtime-сущность не изменена. Документ задаёт только целевую классификацию, имена, semantic contracts и безопасную последовательность следующих блоков.
