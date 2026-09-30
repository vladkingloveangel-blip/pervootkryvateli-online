# Блок 2 — инвентарный аудит карточных и колодных абстракций

Дата аудита: 2026-09-30  
Ветка: `digital-native/refactor`  
Аудируемый HEAD: `253f155a55929ae80382cc88f049cc639fde93b9`

## 1. Граница шага

Этот документ фиксирует фактическое состояние кода перед цифровым рефакторингом. На этом шаге архитектура и игровая механика не менялись.

Поиск выполнен по runtime, master-data, серверу, клиенту, persistence, тестам и документации по словам и связанным структурам: `card`, `cards`, `deck`, `drawPile`, `discard`, `hand`, события, вражда, поручения, якоря, легендарные карты/эффекты, сокровища, экспедиции, именные карты, сохранённые эффекты, а также соседние карточные эффекты персонажей и зданий.

В проекте нет единого поля `hand`. «Закрытая рука» в текущем runtime — составная концепция из `player.specialCards`, `player.legendaryCards`, `player.savedEventCards`; активное поручение `player.activeAssignment` считается закрытой информацией, но специально исключено из случайного сброса картой вражды.

Все поля комнаты и игроков, перечисленные ниже как persistent, попадают в PostgreSQL без отдельной схемы полей: `room-store.js` делает глубокий JSON-снимок всей комнаты и сохраняет его в `game_rooms.state JSONB`. При восстановлении незавершённой комнаты сервер затем запускает `normalizeStage6Compatibility()`.

## 2. Классификация найденных сущностей

| Категория | Текущая модель | Физическая колода влияет на механику? |
| --- | --- | --- |
| Якоря — `room.anchorDecks` | реальный `drawPile + discard + reshuffle` по 3 цветам | Да: порядок, исчерпание, возврат сброса и верхняя карта важны |
| События плавания — `room.eventDeck` | реальный `drawPile + discard + reshuffle` | Да: порядок и удержание карты игроком временно меняют состав колоды |
| Вражда — `room.feudDecks` | реальный `drawPile + discard + reshuffle` по государствам | Да |
| Поручения — `room.assignmentDecks` | `drawPile + discard + removed`, с фильтрацией допустимости | Да, и модель сложнее обычной колоды |
| Экспедиции — `room.expeditionDeck` | один `drawPile`, активная карта временно изъята и после завершения возвращается с перемешиванием | Да |
| Сокровища | `TREASURE_CARDS + BALANCE.treasurePool`, независимый uniform random-with-replacement | Нет. `treasureDeck` не создаётся и не читается gameplay-кодом |
| Легендарные награды | `LEGENDARY_CARDS + BALANCE.legendaryPool`, независимый uniform random-with-replacement | Нет. `legendaryDeck` удалён из текущей модели |
| Именные карты мест | `player.namedPlaceCards` + `room.legendaryPlacesExplored` | Нет: это запись первого открытия/достижения |
| Закрытые сохранённые карты | `specialCards`, `legendaryCards`, `savedEventCards` | Частично: только `savedEventCards` удерживают конкретный экземпляр из `eventDeck` |
| Сохранённые эффекты | `activeTurnEffects`, `nextTurnEffects`, `legendaryEffects`, `legendaryVeil*` | Нет: это состояние эффекта после разрешения карты |
| Персонажи | `player.character` + каталог `CHARACTERS` | Нет общей колоды; выбор идёт из доступного каталога, но отдельные эффекты завязаны на карточные/колодные понятия |

## 3. Реальные runtime-колоды

### 3.1. `room.anchorDecks`

**Определения:** `rules/sea.json` → `rules/runtime.js: ANCHOR_CARDS`. Три цветовые группы: blue/yellow/red, по 10 физических экземпляров после разворачивания `quantity`.

**Создание и хранение:** `game-logic.js:createAnchorDecks()` создаёт для каждого цвета `{ drawPile, discard }`; `server.js` создаёт их при создании комнаты и заново при старте партии. Хранятся в `room.anchorDecks[color]`.

**Изменение:** `drawAnchorCard()` берёт `drawPile.shift()`; при пустом `drawPile` перемешивает `discard` обратно. `resolveAnchorEncounter()` после разрешения всегда кладёт взятую карту в `drawn.deck.discard`. Дополнительно игрок хранит `visitedAnchors` и `lastAnchorEncounter`, но это не части колоды.

**Клиент:** `publicRoom()` отправляет всем только счётчики `remaining/discard` по цветам, не содержимое piles. Картограф через `useCartographer` приватно получает верхнюю карту `room.anchorDecks[color].drawPile[0]` без изменения порядка. Это жёсткая зависимость от понятия «верхняя карта».

**Persistent save:** да, целиком вместе с комнатой.

**Физическая модель:** реально значима для механики: порядок, исчерпание и reshuffle влияют на следующие встречи; Картограф зависит от top-of-deck.

**Тесты:** `test/game-logic.test.js` проверяет размеры колод, quantity, draw/discard и разрешение якорей; `test/server.test.js` проверяет публичные счётчики и восстановление старой модифицированной верхней карты; правила и количества покрыты `test/rules-data.test.js`.

**Legacy:** старые экземпляры anchor-карт в сохранении не канонизируются при draw; тест рестарта намеренно подтверждает сохранение старого значения artillery. Это сознательная save-совместимость текущего кода.

### 3.2. `room.eventDeck`

**Определения:** `rules/events.json:sailing` → `rules/runtime.js: SAILING_EVENT_CARDS`. Сейчас 26 экземпляров после учёта `quantity`.

**Создание и хранение:** `createSailingEventDeck()` → `{ drawPile, discard }`; создаётся в `server.js` при создании комнаты и старте игры; хранится в `room.eventDeck`.

**Изменение:** `drawSailingEventCard()` использует общий `drawCyclingDeckCard()`; при исчерпании сброс перемешивается обратно. После обычного разрешения `discardDeckCard(room.eventDeck, card)`. Обсерватория может сбросить первую карту без применения и обязать взять вторую.

Особый случай: `found-cargo` без свободного трюма и `save-card` не идут сразу в discard. `saveHeldEventCard()` кладёт в `player.savedEventCards` копию исходной карты как `sourceCard`; пока она удерживается игроком, этот конкретный экземпляр фактически отсутствует и в draw pile, и в discard. При использовании или случайном сбросе сохранённой карты `discardSavedCardToDeck()` возвращает `sourceCard` в `eventDeck.discard`.

**Transient-состояние:** `room.eventPhase.lastCard`, `room.pendingEvent.eventCard` и связанные options хранят незавершённое разрешение и тоже persist через общий room snapshot.

**Клиент:** всем видны только `eventDecks.sailing.remaining/discard`; имя текущей/ожидающей решения карты выводится через event state, а варианты выбора доступны только соответствующему игроку. Содержимое piles не передаётся.

**Persistent save:** да.

**Физическая модель:** реально значима. Особенно важна связь с `savedEventCards`: удержание физического экземпляра меняет будущий состав cycling deck.

**Тесты:** `test/game-logic.test.js` (26 карт, draw/discard, canonicalization), `test/stage-6-events.test.js` (Обсерватория, два сброса, event flow), `test/party-clock.test.js`; `test/fixtures/clock-deck.cjs` подменяет только тестовую `createSailingEventDeck` детерминированной колодой.

**Legacy:** `canonicalSailingEventCard()` при вытягивании сопоставляет старый `id/masterCardId` с актуальным определением. Это позволяет старой карте в сохранении получить современный effect/timing при фактическом розыгрыше.

### 3.3. `room.feudDecks`

**Определения:** `rules/events.json:feud` → `rules/runtime.js: FEUD_CARDS`. Шесть фракций, по 10 экземпляров каждая.

**Создание и хранение:** `createFeudDecks()` создаёт `room.feudDecks[factionId] = { drawPile, discard }`.

**Изменение:** `drawFeudCard()` использует cycling draw с reshuffle discard. После мгновенного эффекта или после завершения `room.pendingFeud` карта отправляется в discard.

**Клиент:** всем передаются только `remaining/discard`; во время pending-решения — имя/тип карты, а приватные options только затронутому игроку.

**Persistent save:** да, включая `pendingFeud` и сам `pending.feudCard`.

**Физическая модель:** реально значима: карты без возвращения до reshuffle меняют распределение последующих результатов.

**Тесты:** `test/game-logic.test.js`, `test/stage-6-events.test.js`, `test/rules-effects.test.js`, `test/rules-data.test.js`, `test/rules-compatibility.test.js`.

**Legacy:** `rules/compatibility/legacy.json:feud` хранит старые id/type → `masterCardId`; `server.js:canonicalFeudCard()` сопоставляет старый `masterCardId/id` с текущей canonical card перед разрешением. Старые pending-решения также продолжают поддерживаться.

### 3.4. `room.assignmentDecks`

**Определения:** `rules/politics.json:assignments` → `rules/runtime.js: ASSIGNMENT_CARDS`. Пять сюзеренов: lionia, kadingir, mori, suniksiya, pirates; всего 49 определений/экземпляров. У Mayo колоды поручений нет.

**Создание и хранение:** `createAssignmentDecks()` создаёт по фракции `{ drawPile, discard, removed }`.

**Изменение:** `drawAssignmentCandidates()`:
- берёт карты из `drawPile`;
- при первом исчерпании за вызов перерабатывает `discard` обратно в shuffled draw pile;
- `eligible` выдаёт;
- `skip` временно пропускает и затем перемешивает обратно;
- `remove` кладёт в `removed`, то есть исключает из текущей партии;
- Посольство берёт до двух допустимых карт, выбранная становится `player.activeAssignment`, невыбранная возвращается в draw pile с перемешиванием;
- завершённое или отменённое активное поручение уходит в discard.

**Связанные player/room поля:** `player.activeAssignment = { instanceId, factionId, card, issuedRound, progress? }`; `room.pendingAssignmentChoice` содержит временное предложение Посольства.

**Клиент:** всем видны счётчики `remaining/discard/removed` и `hasActiveAssignment`; полное активное поручение выдаётся только владельцу. Варианты Посольства видит только игрок, который выбирает.

**Persistent save:** да.

**Физическая модель:** значима сильнее обычного random source: порядок, discard cycle, permanent `removed`, временный skip и возврат невыбранной карты влияют на доступный набор.

**Тесты:** `test/game-logic.test.js` (создание, eligibility, offer/choose, completion), `test/stage-6-events.test.js`, `test/server.test.js`, `test/rules-data.test.js`, `test/rules-effects.test.js`, `test/rules-compatibility.test.js`.

**Legacy:** `normalizeAssignmentCompatibility()` восстанавливает отсутствующие faction decks, не возвращая уже зарезервированные active/pending cards; добавляет отсутствующие массивы `drawPile/discard/removed`; создаёт legacy `instanceId`; восстанавливает progress старых Mori; удаляет `replacedAssignmentConditions`, старые non-Embassy choice и переводит `assignment-replace` в современную стадию. Отдельная старая механика платной замены не является текущей механикой.

### 3.5. `room.expeditionDeck` и активные экспедиции

**Определения:** `rules/legends.json:expeditions` → `EXPEDITION_CARDS`: семь карт, по одной на каждое морское легендарное место.

**Создание и хранение:** `createExpeditionDeck()` возвращает только `{ drawPile }`; discard отсутствует. Room хранит `expeditionDeck`, игрок — `activeExpedition`, `expeditionHistory`, `expeditionDrawRound`, `expeditionsDrawnThisRound`.

**Изменение:** `takeExpedition()` последовательно shift-ит кандидатов до допустимого; недопустимые для конкретного игрока кандидаты перемешиваются обратно. Взятая карта удалена из deck на время активности. `completeExpeditionAtArrival()` записывает историю, возвращает карту в `room.expeditionDeck.drawPile` и перемешивает, затем очищает `activeExpedition`.

**Награда:** `server.js:handleExpeditionArrival()` ставит запись в `room.pendingExpeditionRewards`; `drainExpeditionTreasureRewards()` разрешает её через цифровой `drawTreasureCard()`. Это не отдельная treasure deck.

**Клиент:** всем виден remaining count экспедиций и публичная metadata активной экспедиции; owner дополнительно получает `requiresLeaveAndReturn`, полную собственную историю и возможность взять экспедицию. Полная история других игроков не публикуется, только count.

**Persistent save:** да, включая active/history/deck/pending rewards.

**Физическая модель:** да: существует реальная shuffled очередь, активная карта резервируется и не может одновременно выпасть другому игроку; после завершения возвращается. Это не стандартный draw/discard cycle.

**Тесты:** `test/game-logic.test.js`, `test/server.test.js`, `test/stage-6-legendary.test.js`, `test/stage-6-ui.test.js`, `test/rules-data.test.js`.

**Legacy:** `normalizeStage6Compatibility()` удаляет неканонические старые места из history/active/deck, канонизирует valid active expedition и при отсутствующей колоде создаёт новую без карт, уже занятых active expeditions.

## 4. Цифровые случайные источники без физической колоды

### 4.1. Сокровища: `TREASURE_CARDS`, `BALANCE.treasurePool`, отсутствие `treasureDeck`

**Источник:** `rules/legends.json:treasures/treasurePool`, runtime в `rules/runtime.js`.

**Текущая механика:** `drawTreasureCard(_room, rng)` игнорирует состояние комнаты и независимо выбирает один элемент `TREASURE_CARDS`. Канон: `mode = random-with-replacement`, `selection = uniform`, четыре typeIds. Draw/discard/reshuffle отсутствуют.

**Где используется:** события типа `treasure`, награды завершённых экспедиций и связанные assignment-триггеры.

**Клиент:** `publicRoom().treasurePool` публикует mode/selection/typeIds; физический pile не существует.

**Persistent save:** текущая механика ничего для пула не сохраняет.

**Legacy:** старое поле `room.treasureDeck` может физически присутствовать в JSONB старой комнаты, потому что `RoomStore` сохраняет неизвестные поля и текущая нормализация его явно не удаляет. При этом runtime нигде не читает `treasureDeck`; `drawTreasureCard()` его не потребляет. `rules/compatibility/legacy.json:treasure` сохраняет описание retired `full-ore-hold` только для проверки совместимости данных. `test/room-store.test.js` прямо проверяет, что старый `treasureDeck` не влияет на новый цифровой draw.

**Тесты:** `test/game-logic.test.js` проверяет четыре равномерно индексируемых исхода; `test/rules-data.test.js` и `test/rules-compatibility.test.js` проверяют digital pool и отсутствие canonical `treasureDeck`.

**Технический долг, только зафиксирован:** `public/app.js` всё ещё показывает для Искателя сокровищ текст о будущей «синхронизации колоды сокровищ». Это устаревшая физическая терминология относительно блока 1; на этом шаге не исправлялась.

### 4.2. Легендарные награды: `LEGENDARY_CARDS`, `BALANCE.legendaryPool`, отсутствие `legendaryDeck`

**Источник:** `rules/legends.json:legendary/legendaryPool`.

**Текущая механика:** `drawLegendaryCard(_room, rng)` независимо выбирает один из четырёх typeIds; `random-with-replacement`, uniform. Нет draw pile, discard pile или количества физических копий.

**Получение:** sailing event типа `legendary`, первое открытие легендарного места, военные награды отдельных островов. Полученный экземпляр помещается в `player.legendaryCards`.

**Расход:** обычное применение, hostile/reaction resolution или случайный discard из закрытой руки удаляет экземпляр из массива через splice. Он не возвращается ни в какой discard/pool, потому что pool математически бесконечен по повторениям.

**Клиент:** владельцу — список id/name/handIndex и playable refs; остальным — только `legendaryCardCount`. `publicRoom().legendaryPool` публикует устройство цифрового пула.

**Persistent save:** `player.legendaryCards` сохраняется, сам pool — статические правила.

**Legacy:** `normalizeAssignmentCompatibility()` явно удаляет `room.legendaryDeck`; старый `player.pendingLegendary` конвертируется в соответствующее число независимых digital draws и затем удаляется. На сыром уровне `RoomStore` старое поле сначала может быть загружено без изменений, но серверная нормализация удаляет его.

**Тесты:** `test/game-logic.test.js`, `test/stage-6-legendary.test.js`, `test/server.test.js`, `test/room-store.test.js`, `test/rules-data.test.js`, `test/rules-compatibility.test.js`, `test/stage-6-ui.test.js`.

## 5. «Рука», сохранённые карты и связанные игровые сущности

### 5.1. `player.savedEventCards`

Массив конкретных сохранённых событий: `{ id, kind, name, sourceDeck:'event', sourceCard, ... }`. Создаётся `saveHeldEventCard()`, хранится у игрока, используется обработчиками `useSavedCargo`, `useShipMaster`, `useBlueprint`; после использования удаляется и исходный `sourceCard` возвращается в `room.eventDeck.discard`. Случайный feud-discard делает то же.

Клиент владельца видит id/kind/name/goodId; другие игроки — только count. Persistent: да. Legacy normalizer создаёт пустой массив, если поля не было. Покрытие: game-logic/server/stage-6 events и UI.

### 5.2. `player.legendaryCards`

Это не колода, а закрытый inventory экземпляров, полученных из digital legendary pool. Создаётся пустым в `newPlayer`; пополняется событиями/наградами; удаляется при использовании/reaction/random held discard. Клиент: детали владельцу, count остальным. Persistent: да. Legacy: missing array восстанавливается; `pendingLegendary` мигрируется сюда.

### 5.3. `player.specialCards`

Массив строк-названий одноразовых особых карт. Пополняется sailing `special-card` и фиксированной наградой острова (например, `legendaryCardId` → имя); участвует в общем API легендарных refs и в random held discard. Никакой собственной колоды/сброса нет. Клиент: список владельцу, count остальным. Persistent: да.

Это параллельное представление тех же видов легендарных эффектов и потенциальная цель нормализации в следующих шагах, но на шаге 1 не изменялось.

### 5.4. `player.activeAssignment`

Активное поручение хранит полную копию `card` и progression. Это не «рука» как массив и не draw pile, но является закрытой карточной сущностью, полученной из `assignmentDecks`. После завершения/отмены card возвращается в assignment discard. Детали доступны только владельцу; у остальных только boolean. Persistent: да. Старые active assignments мигрируются через legacy instanceId/progress.

### 5.5. Концептуальная закрытая рука и `discardRandomHeldCard()`

Функция строит временный список refs из:
- `specialCards`;
- `legendaryCards`;
- `savedEventCards`.

Затем равновероятно выбирает один held item и удаляет его. Активное поручение намеренно не включается, хотя комментарий фиксирует его принадлежность к закрытой руке с точки зрения информации. Отдельного `hand` поля, общего типа Card или общего inventory в текущем коде нет.

## 6. Именные карты и первое открытие

### `NAMED_PLACE_CARDS`, `player.namedPlaceCards`, `room.legendaryPlacesExplored`

`rules/legends.json:namedCards` содержит 10 открытых именных карточек, по одной на место. Runtime `claimLegendaryPlaceDiscovery()` не вытягивает их из shuffled deck: первое открытие фиксируется в `room.legendaryPlacesExplored[placeId] = playerId`, после чего соответствующая canonical card копируется в `player.namedPlaceCards`.

Draw/discard/reshuffle отсутствуют. Физическая quantity=1 служит валидацией уникальности данных, но runtime-уникальность обеспечивается registry первого открытия.

Клиент: общий `namedPlaceCards` каталог с `claimedBy` публичен всем; player copy и count также публичны. Persistent: registry и player arrays сохраняются. Legacy: normalizer умеет восстановить registry из старых player cards и, наоборот, добавить отсутствующую player card по registry.

Тесты: `test/game-logic.test.js`, `test/server.test.js`, `test/stage-6-legendary.test.js`, `test/stage-6-ui.test.js`, `test/rules-data.test.js`.

## 7. Сохранённые эффекты, возникшие из карт

### 7.1. `player.activeTurnEffects` и `player.nextTurnEffects`

События типа `turn-effect` преобразуются из card object в числовое/boolean состояние эффекта. В современном персональном шестом круге эффект попадает в `activeTurnEffects`; `nextTurnEffects` остаётся fallback для legacy non-personal event-phase save. В начале хода next копируется в active и очищается; в конце хода active очищается.

Клиент: только владельцу. Persistent: да. Это уже цифровая state-модель, а не колода.

### 7.2. `player.legendaryEffects`

Содержит длительные эффекты легендарных карт, в частности `shipVeil`, `shipVeilReaction`, `seaCurses[]`. `tickLegendaryEffectsForPlayer()` уменьшает сроки и удаляет истёкшие записи.

Клиент получает производный `legendaryStatus` (turn counts/penalty). Persistent: да. Legacy normalizer создаёт `{ seaCurses: [] }`, если структуры не было.

### 7.3. `island.legendaryVeil` / `island.legendaryVeilReaction`

Остров хранит длительную защиту или краткую реактивную защиту после применения «Покрова моря». Это state эффекта, не card object. `publicIsland()` публикует активный `legendaryVeil`; reaction участвует в server-side pending logic. Persistent: да.

### 7.4. `room.pendingLegendaryReaction`

Transient server state для враждебной легендарной карты и реакции «Покровом моря». Сохраняется вместе с room snapshot. Клиент видит metadata реакции, а допустимые `veilOptions` — только целевой игрок. После решения consumed cards удаляются из hand arrays; отдельного discard нет.

## 8. Прочие card/deck-зависимости

### 8.1. Обсерватория: `effect.type = replace-event`

`rules/economy.json`. Runtime реально работает с `room.eventDeck`: первая sailing card может быть сброшена без применения, затем берётся обязательная вторая. Поэтому это прямая зависимость от физического event draw/discard.

### 8.2. Посольство: `effect.type = choose-assignment`, `draw:2`, `keep:1`

`rules/economy.json`. Runtime реально draw-ит до двух cards из assignment deck; невыбранная возвращается в draw pile. Прямая зависимость от assignment deck.

### 8.3. Картограф: `effect.type = peek-sea-deck`

`rules/characters.json`. Реализован в `server.js:useCartographer`: читает `room.anchorDecks[color].drawPile[0]`. Прямая зависимость от top-of-deck и порядка.

### 8.4. Искатель сокровищ: `effect.type = choose-treasure`, `draw:2`, `keep:1`

Определён и валидируется, но отдельного runtime handler для применения в текущем HEAD не найден. UI прямо сообщает, что эффект отложен. Поскольку canonical treasure source уже digital random-with-replacement, этот эффект является будущей зависимостью, которую нельзя автоматически трактовать как необходимость `treasureDeck`.

### 8.5. Разведчик: `effect.type = inspect-hidden-cards`

Определён с `assignmentVisibility:null` и `unresolved:'R29'`; runtime просмотра скрытой информации не активирован. Это зависимость будущего блока серверной видимости, а не существующая физическая колода.

### 8.6. Персонажи как сущности

`CHARACTERS` выбираются из каталога через `characterOptionsAtAdmiralty()`; `player.character` хранит один id, при использовании персонаж обычно расходуется (`consumeCharacter`). Нет `characterDeck`, draw pile, discard или reshuffle. Доступность определяется уровнем Адмиралтейства и уникальностью уже занятых персонажей.

### 8.7. «Карточки островов»

`rules/islands.json` и тесты используют физическую терминологию карточек островов, но runtime создаёт `room.islands` как постоянные map entities через `cloneIslands()`. Нет island deck/draw/discard. Награды островов могут создавать digital legendary instance или `specialCards`, но сам остров не является runtime card.

### 8.8. Presentation-only `*-card`

`public/app.js`, `public/index.html`, `public/styles.css` содержат CSS/DOM классы вроде `player-card`, `admin-room-card`, `map-info-card`, `named-place-card`, `legendary-card`. Это визуальные контейнеры, не игровые deck/card структуры.

## 9. Transient карточное состояние комнаты

Следующие поля не являются колодами, но сохраняют незавершённую карточную механику и поэтому должны учитываться при будущем рефакторинге save format:

- `room.eventPhase` и `eventPhase.lastCard`;
- `room.pendingEvent` с server-only `eventCard` или expedition treasure decision;
- `room.pendingFeud` с `feudCard`;
- `room.pendingAssignmentChoice`;
- `room.pendingLegendaryReaction`;
- `room.pendingExpeditionRewards`.

Все они persistent через общий room snapshot. `publicRoom()` выдаёт клиенту только безопасные projections, а не весь server object.

## 10. Legacy-поля и совместимость старых сохранений

| Legacy-структура | Текущее поведение |
| --- | --- |
| `room.legendaryDeck` | явно удаляется `normalizeAssignmentCompatibility()` |
| `player.pendingLegendary` | конвертируется в digital draws → `player.legendaryCards`, затем удаляется |
| `room.treasureDeck` | gameplay не читает; явного удаления в runtime-нормализации не найдено, поэтому поле может оставаться inert в старом JSONB |
| старые sailing cards | канонизируются по `id/masterCardId` при draw |
| старые feud cards | канонизируются по `id/masterCardId` перед resolution; legacy mapping хранится в `rules/compatibility/legacy.json` |
| отсутствующие assignment decks | восстанавливаются с исключением уже зарезервированных active/pending cards |
| `replacedAssignmentConditions` | удаляется |
| старый `assignment-replace` event stage | переводится в современную assignment stage |
| старые expedition cards/places | invalid entries удаляются, active card канонизируется, missing deck rebuild без active cards |
| отсутствующие `namedPlaceCards`, `legendaryEffects`, `savedEventCards` | создаются/восстанавливаются нормализатором |
| `nextTurnEffects` | сохраняется как compatibility fallback для старого timing event phase |

Важно: `test/room-store.test.js` специально подтверждает, что сам persistence-layer не переписывает старое состояние. Миграции происходят выше, в server initialization. Поэтому будущая миграция формата должна учитывать два слоя: raw JSONB и normalized live room.

## 11. Покрытие тестами по категориям

- **Anchor decks:** `test/game-logic.test.js`, `test/server.test.js`, `test/rules-data.test.js`.
- **Sailing event deck / saved event cards / Observatory:** `test/game-logic.test.js`, `test/stage-6-events.test.js`, `test/party-clock.test.js`, `test/fixtures/clock-deck.cjs`.
- **Feud decks:** `test/game-logic.test.js`, `test/stage-6-events.test.js`, `test/rules-effects.test.js`, `test/rules-data.test.js`, `test/rules-compatibility.test.js`.
- **Assignment decks / active assignments / Embassy:** `test/game-logic.test.js`, `test/stage-6-events.test.js`, `test/server.test.js`, `test/rules-data.test.js`, `test/rules-effects.test.js`.
- **Expeditions:** `test/game-logic.test.js`, `test/server.test.js`, `test/stage-6-legendary.test.js`, `test/stage-6-ui.test.js`, `test/rules-data.test.js`.
- **Digital treasures:** `test/game-logic.test.js`, `test/room-store.test.js`, `test/rules-data.test.js`, `test/rules-compatibility.test.js`.
- **Digital legendary pool / hand / reactions/effects:** `test/game-logic.test.js`, `test/stage-6-legendary.test.js`, `test/server.test.js`, `test/room-store.test.js`, `test/rules-data.test.js`, `test/rules-compatibility.test.js`, `test/stage-6-ui.test.js`.
- **Named place cards:** `test/game-logic.test.js`, `test/server.test.js`, `test/stage-6-legendary.test.js`, `test/stage-6-ui.test.js`, `test/ui-data-smoke.cjs`.
- **Card-facing building/character effects:** `test/rules-effects.test.js`, `test/rules-data.test.js`; реализованные Cartographer/character basics также покрывает `test/game-logic.test.js`.
- **Persistence/legacy:** `test/room-store.test.js`, restart-сценарии `test/server.test.js`.

## 12. Вывод для следующих шагов

Текущий код содержит пять реально stateful источников с физической семантикой: anchor, sailing event, feud, assignment и expedition. Из них первые четыре используют или имитируют draw/discard cycle, а expedition использует shuffled reservation/return model.

Treasure и legendary уже переведены на независимые digital pools и не требуют физических колод. Named-place cards уже по сути являются достижениями/registry, а не random cards. Сохранённые event cards — наиболее сильная перекрёстная зависимость: player inventory удерживает конкретный экземпляр из cycling event deck. Cartographer, Observatory и Embassy также напрямую зависят от порядка/состава соответствующих deck structures.

Никаких архитектурных изменений, переименований или удаления legacy-кода в этом шаге не выполнено.
