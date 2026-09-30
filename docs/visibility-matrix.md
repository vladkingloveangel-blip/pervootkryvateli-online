# Visibility matrix — author-approved policy (Block 4.1)

Дата фиксации: 2026-09-30  
Ветка: `digital-native/refactor`  
Основание: author-approved R29 / visibility decision перед Block 4.

## 1. Статус документа

Этот документ фиксирует утверждённую policy видимости для Block 4. Он не меняет runtime и не вводит projection engine.

Canonical machine-readable fixture для реализации шагов 4.2–4.7:

`test/fixtures/visibility-matrix.json`

Fixture является source of truth для категорий, viewer roles, Scout override и security-инварианта. При расхождении будущей реализации с fixture реализация должна быть исправлена либо policy должна быть отдельно переутверждена автором.

## 2. Security invariant

**hidden means omitted from unauthorized payload, not merely hidden in UI**

Если viewer не имеет права видеть property, property должна отсутствовать в его projection полностью. Недопустимо передавать настоящее значение и скрывать его CSS, передавать `null`, пустой массив/объект как sentinel скрытого значения или отправлять hidden flag рядом с настоящим значением.

Derived fields, counters, totals, breakdowns и action hints наследуют privacy classification источника, если по ним можно непосредственно восстановить скрытое значение или факт существования скрытого state.

Пример: скрытый гарнизон означает, что opponent не должен получать ни `garrisonType`, ни `garrisonDefense`, ни `defenseArmy`/`defenseBreakdown`, если они позволяют определить наличие или тип скрытого гарнизона. Публичные форт, бастион и другие открытые постройки при этом остаются видимыми.

## 3. Viewer roles и композиция прав

- `owner`: владелец private player-state; для island-private state — владелец острова.
- `opponent`: другой обычный участник партии.
- `scout`: opponent с одним действующим Scout reveal grant для одной выбранной сущности/свойства. Вне этого grant имеет обычную opponent visibility.
- `pendingActor`: игрок, который обязан принять именно это pending-решение. Роль добавляет доступ только к private content этого конкретного решения.
- `publicObserver`: наблюдатель с public-only projection; Scout grants игроков ему не передаются.

Права контекстные, а не глобальные. Например, игрок может быть owner своих денег и одновременно pendingActor отдельного решения. Owner не получает чужие private pending options только потому, что он owner собственного player-state; pendingActor не получает чужие деньги/персонажа/поручение только потому, что сейчас принимает решение.

## 4. Public world state

Остров публичен как объект мира: положение, `ownerId`, имя и обычная информация, ресурсы, статус поселение/город/большой порт, все обычные постройки, их типы, уровни/ступени, обычное состояние и публичные эффекты. Всё, что непосредственно определяется из этих открытых построек, также публично.

Корабль другого игрока можно открыть как карточку. Публичны позиция, класс/уровень, основные характеристики, боевая сила и открытые боевые характеристики, ship upgrades, escorts и их активность, груз/трюмы, грузовые параметры и остальные обычные ship properties, которые отдельно не классифицированы как private.

Публичны `suzerainId`, факт вассалитета и обычные публичные политические отношения. Публичны завершённые first discoveries, исследованные легендарные места и завершённые достижения/открытия, которые уже стали фактом общего игрового мира.

Static definitions не становятся private из-за private instance state: catalog персонажей и правила персонажей публичны; definitions legendary abilities публичны; публичные static assignment definitions могут оставаться на клиенте. Скрывается конкретный instance/holding конкретного игрока.

## 5. Island-private state: garrison

Дополнительный гарнизон острова private. Owner острова видит его полностью.

Opponent и publicObserver не получают `garrisonType`, факт наличия скрытого гарнизона, его отдельную силу, private defense breakdown или derived total, позволяющий восстановить гарнизон.

Scout может раскрыть гарнизон ровно одного выбранного острова в допустимой дальности. Это не раскрывает другие private properties владельца острова.

## 6. Player-private state

`player.ducats` виден owner. Opponent/publicObserver точную сумму и directly-derived exact-money fields не получают. Единственный Scout override — деньги одного выбранного другого игрока при соблюдении R29.

Текущий held character private. Owner видит своего персонажа; opponent/publicObserver не получают identity или derived identity hints. Scout персонажа не раскрывает.

Active assignment полностью private для owner: карточка/задача, condition, target, progress, reward, `instanceId`, required action и private hints. Факт существования поручения также private: нельзя отдавать `hasActiveAssignment`, count/progress/reward counters или другие existence signals. Scout поручения не раскрывает. Публичным остаётся только отдельное политическое знание `suzerainId`.

Личные inventories/benefits полностью private для owner: `specialCards`, `legendaryCards`, `savedEventCards` и аналогичные consumable/stored abilities. Скрыты content, types, IDs, effects и counts. Scout эти категории не раскрывает.

Текущая active expedition private: скрыты факт наличия, card id/name, target/place, progress/state, `acceptedRound`, leave-and-return state и `hasActiveExpedition`/аналогичные existence flags. Scout active expedition не раскрывает. Уже завершённая публичная история открытий остаётся публичной.

## 7. Pending resolutions

Полный private content конкретного личного pending decision видит только соответствующий `pendingActor`.

Другим viewers разрешён только минимальный public waiting envelope: что игра ожидает решение и, когда это действительно нужно общему UI, идентификатор игрока, который должен ответить.

Для остальных viewers должны быть omitted private `kind`, если он раскрывает скрытую механику, hidden card/source, `options`, конкретный выбор, hidden target data, assignment details, legendary/saved-event details и другая private context. Scout pending private content не раскрывает.

Обычные публичные факты уже начавшегося боя, союза или другого публичного события не становятся тайными только из-за существования pending state.

Embassy/pending assignment options доступны только соответствующему `pendingActor`.

## 8. Scout / R29

Текущая rule definition: range 4, Manhattan distance, `useActionCost = 1`, персонаж расходуется после применения.

За одно применение выбирается ровно один вид разведки:

1. `garrison`: скрытый гарнизон одного выбранного острова в Manhattan distance <= 4 от корабля разведующего игрока.
2. `money`: текущее количество денег одного выбранного ДРУГОГО игрока, если его корабль находится в Manhattan distance <= 4.

Одно применение не может раскрыть одновременно деньги и гарнизон. Reveal получает только игрок, использовавший Scout. Reveal действует до конца его текущего личного хода. Reconnect в том же личном ходу должен в будущей реализации сохранять grant; окончание личного хода должно его завершать.

Scout не раскрывает character, active assignment и его progress/reward, legendary/private abilities, `specialCards`, `savedEventCards`, active expedition, pending options/context или другие private properties.

Lifecycle semantics на шаге 4.1 только документируются. Никакие reveal grants, room/player fields или runtime handlers здесь не создаются.

## 9. Current runtime audit notes — future migration targets

Ниже перечислены только несовпадения, подтверждённые в текущем HEAD `4f0949b51a80b983167df02035c30205126771da`. Это audit notes для 4.2–4.4, а не изменения 4.1.

- `game-logic.js/publicIsland()` сейчас включает `garrisonType`, `garrisonName` и `garrisonDefense` в обычный island view. `server.js/publicRoom()` дополнительно публикует `defenseArmy` и `defenseBreakdown` для каждого острова.
- `publicRoom()` сейчас безусловно включает `player.ducats`.
- `activeAssignment` для не-owner сейчас присутствует как `null`, а `hasActiveAssignment` публикуется безусловно. Оба поведения не соответствуют omission invariant.
- `specialCards`, `legendaryCards` и `savedEventCards` для не-owner сейчас маскируются пустыми массивами, а `specialCardCount`, `legendaryCardCount`, `savedEventCardCount` публикуются безусловно.
- `activeExpedition` и `hasActiveExpedition` сейчас публикуются для всех viewers; только отдельный leave-and-return detail частично owner-gated.
- Held character identity уже owner-gated, но для не-owner поле `character` всё ещё присутствует как `null`; будущая projection должна именно omit private property.
- Pending event/feud envelope сейчас публикует `kind` и `cardName` всем viewers, а закрытые `options` маскирует `[]`. Embassy pending choice публикует `kind`/faction context всем, options оставляя actor-only. Legendary reaction публикует `kind`/source/target/island всем, а `veilOptions` маскирует `[]`. На следующих шагах это нужно разделить на минимальный public envelope и actor-only private content в соответствии с fixture.

Шаг 4.1 намеренно не исправляет ни один из этих пунктов.

## 10. Scope boundary 4.1

На этом шаге не меняются `server.js`, `game-logic.js`, `public/app.js`, `publicRoom()`, socket payloads, UI, persisted room/player state, save format, Scout runtime, source adapters или random sources.

Не создаются projection engine, `state-projection.js`, reveal grants или новые room/player fields.

Следующий шаг 4.2 не является частью этого commit.
