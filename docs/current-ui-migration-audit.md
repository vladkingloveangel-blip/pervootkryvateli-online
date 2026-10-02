# Current frontend audit for mobile UI migration

Status: UI-1 audit baseline.
Audited branch HEAD: 6006555d2755b94d8a587fd7fd94180f46e5905c.
Canonical target specification: docs/mobile-ui-ux-spec.md.

This document inventories the current client presentation so the new mobile-first UI can replace it without losing gameplay access, privacy guarantees or socket command coverage.

## 1. Current frontend shape

The gameplay client is concentrated in:

- public/index.html — static DOM structure;
- public/app.js — rendering, local UI state, map interaction and socket command wiring;
- public/styles.css — responsive/current visual layout;
- server.js — socket command handlers and room-state production;
- state-projection.js — viewer-specific public/private projection.

Current mobile navigation is organized around four tabs:

- Map;
- Actions;
- Ship;
- Players.

The side panel currently contains many permanent mechanic-oriented panels. This is the architecture the redesign will retire.

The existing map implementation is valuable and should be retained as the new shell foundation:

- mapViewport;
- mapBoard;
- map art layer;
- grid layer;
- ownership layer;
- object layer;
- label layer;
- highlight layer;
- token layer;
- reachable-cell highlights;
- zoom;
- center-on-player;
- current map object rendering.

## 2. Current HUD audit

Existing HUD already exposes:

- player name;
- ship level;
- ducats;
- glory;
- armyPoints;
- fleetPoints;
- cargo;
- debt;
- round/turn information.

Target changes:

- keep player/ship, ducats, glory and cargo;
- replace armyPoints/fleetPoints in permanent HUD with actual combat characteristics: army/boarding strength and artillery;
- move scoring metrics to Game Metrics;
- debt is not a default global HUD metric unless the owner-facing design explicitly needs it;
- add clearer round/circle/phase/current-turn hierarchy;
- make HUD entries direct navigation to fleet/cargo/effects/politics sheets.

Current renderer: renderMobileHud.

Removal/replacement gate: UI-5 plus UI-26 for scoring metrics.

## 3. Current panel-to-new-UX migration matrix

| Current UI | Current renderer | Main commands / behavior | Target UX | Safe removal after |
| --- | --- | --- | --- | --- |
| legacy status block | render / general state | room code, round, current turn | HUD + Menu/share room controls | UI-6 and UI-25 |
| controls / “Ход” | renderControls | rollMove, skipNavigation, endTurn via existing buttons | state-driven action bar | UI-6 |
| event panel | renderEvents | respondEvent, respondFeud, saved benefits/cards | Event Scene + Decision Layer + Cards where applicable | UI-21/22 |
| politics panel | renderPolitics | enterVassalage, rebelVassalage | state-island context + suzerain HUD + Diplomacy | UI-23 |
| island correction panel | renderIslandCorrection | resolveIslandCorrection | Decision Layer | UI-7 |
| fleet adjustment panel | renderFleetAdjustment | resolveFleetAdjustment | Decision Layer | UI-7 |
| assignment panel | renderAssignments | respondAssignmentChoice + active assignment display | Decision Layer + Goals | UI-17 |
| legendary places panel | renderLegendaryPlaces | takeExpedition, active expedition display | map object sheets + Goals | UI-17 and legendary object coverage |
| legendary cards panel | renderLegendary | playLegendary, respondLegendaryReaction | Cards + targeting + Decision Layer | UI-16 plus UI-7/UI-13 |
| fleet panel | renderFleet | characters, upgrades, fleet info, character abilities | clickable HUD + fleet sheet + contextual character actions | UI-5/UI-14/UI-15 |
| trade panel | renderTrade | sellCargo, cargo/escort cargo | cargo sheet + Citadel context | UI-15 |
| anchor panel | renderAnchors | fightAnchor | anchor object sheet + encounter flow | UI-18 |
| island panel | renderIsland | loadCargo, formLandCompany, usePalace, build, upgradeBuilding | island bottom sheet + expanded island management | UI-10 |
| alliance panel | renderAlliances | request/respond/cancel/break alliance | player card + Decision Layer | UI-24 |
| combat panel | renderCombat | respondBattle, attackShip, assaultIsland | target/player/island context + combat/assault flow + Decision Layer | UI-19/UI-20 |
| players panel | renderPlayers | lobby ship/ready/kick plus in-game player list | pre-game lobby + in-game compact roster/player cards | UI-12 and UI-30 |
| end-game panel | renderEndGame | propose/confirm/reject through end-game command helper | Menu entry + global consensus card + HUD last-round status | UI-28 |
| final results panel | renderEndGame | finalResult rendering | dedicated final results screen | UI-29 |
| mobile action dock | renderControls | duplicate roll/stay/end-turn | unified action bar | UI-6 |
| mobile nav Map/Actions/Ship/Players | mobile navigation logic | switches mechanic tabs | removed; replaced by map + HUD + Cards + Goals + Menu | UI-32 |
| map info card | renderMap / renderCombat | selected map target summary/action | common object bottom-sheet framework | UI-9 |

## 4. Current map/navigation behavior to preserve

Current navigation path uses:

- rollMove;
- skipNavigation;
- moveTo;
- projected reachableCells;
- room movePoints;
- map highlight layer;
- current-player phase/roll state.

Current map UI also contains a map navigation overlay that already approximates part of the future action-bar behavior.

Preserve canonical movement legality. The redesign changes presentation only.

Target:
- action bar owns the phase instruction;
- map highlights legal destinations;
- object-selection and targeting modes share one map interaction framework;
- harmless movement remains low-friction;
- irreversible/high-impact actions may require confirmation.

Replacement gate: UI-4, UI-6 and UI-13.

## 5. Existing renderer inventory

Current primary renderers:

- renderMobileHud;
- renderEndGame;
- renderPlayers;
- renderMapNavigation;
- renderMapContext;
- renderControls;
- renderEvents;
- renderPolitics;
- renderIslandCorrection;
- renderFleetAdjustment;
- renderAssignments;
- renderLegendaryPlaces;
- renderLegendary;
- renderFleet;
- renderTrade;
- renderAnchors;
- renderIsland;
- renderAlliances;
- renderCombat;
- renderMapObjects;
- renderMap.

The migration must not delete a renderer merely because its panel becomes hidden. It can be removed only when every command path and information path it supplies has a replacement.

## 6. Client socket-command coverage to preserve

The current client directly emits gameplay/lifecycle commands including:

Room/account/lobby:
- createRoom;
- joinRoom;
- resumeRoom;
- goHome;
- leaveRoom;
- closeRoom;
- changeShip;
- setReady;
- startGame;
- kickPlayer;
- admin watch/list/close paths.

Navigation/turn:
- rollMove;
- skipNavigation;
- moveTo;
- endTurn.

Island/economy:
- build;
- upgradeBuilding;
- loadCargo;
- sellCargo;
- formLandCompany;
- dismissLandCompany;
- usePalace.

Fleet/character:
- takeCharacter;
- replaceCharacter;
- removeShipUpgrade;
- useNavigator;
- useCartographer;
- useScout;
- useTreasureHunter;
- useFirstMate.

Digital-native benefits/cards:
- playLegendary;
- useSavedCargo;
- useShipMaster;
- useBlueprint.

Encounters/combat:
- fightAnchor;
- attackShip;
- assaultIsland;
- respondBattle;
- respondLegendaryReaction.

Politics/alliance:
- enterVassalage;
- rebelVassalage;
- requestAlliance;
- respondAlliance;
- cancelAllianceRequest;
- breakAlliance.

Pending decisions:
- respondEvent;
- respondFeud;
- respondAssignmentChoice;
- resolveIslandCorrection;
- resolveFleetAdjustment.

Expeditions:
- takeExpedition.

End game:
- proposeEndGame;
- confirmEndGame;
- rejectEndGame.

Some commands are routed through helper functions and therefore are not all visible as literal socket.emit calls inside individual render functions. Migration verification must compare against server command handlers, not only static emit searches.

## 7. Server handlers currently available but easy to lose in UI migration

The server also exposes commands that are not represented by one obvious permanent UI panel or were missed by simple client literal-emission inventory:

- setLeader;
- setSeatingOrder;
- buyShipLevel;
- buyShipUpgrade;
- buyEscort;
- buyCityGuard;
- buyPermanentGarrison;
- buildBastion;
- listMyRooms;
- proposeEndGame;
- confirmEndGame;
- rejectEndGame.

The new UX must ensure every player-facing legal command still has a discoverable route where appropriate.

Lobby commands setLeader/setSeatingOrder belong to UI-30.

Ship/Citadel purchase commands belong to UI-15/fleet-sheet work.

Garrison/bastion commands belong to island management.

End-game commands belong to UI-28.

listMyRooms belongs to entry/lobby UX.

## 8. Mandatory-decision inventory

Current dedicated renderers/panels prove that the client already has multiple mandatory-choice families:

- pendingEvent;
- pendingFeud;
- pendingAssignmentChoice;
- pendingIslandCorrection;
- pendingFleetAdjustment;
- pendingLegendaryReaction;
- pendingBattle participation;
- pendingAlliance response.

These must converge into the unified Decision Layer.

The migration must distinguish:
- mandatory actor-facing decision;
- non-actor waiting state;
- spectator/admin view;
- reconnect into an already pending decision.

No pending family may disappear merely because its old dedicated panel is removed.

Primary replacement gate: UI-7.

## 9. Result/outcome audit

Current implementation often communicates outcomes through changed numbers, panel text, last encounter fields or logs.

Known examples needing explicit outcome UX include:

- anchor encounters;
- sea battles;
- island assaults;
- event effects;
- assignment completion/reward;
- expedition completion/reward;
- treasure results;
- character effects with material outcomes;
- island development/status changes;
- large purchases/upgrades;
- political status transitions;
- final consensus acceptance.

The new hierarchy must classify each as:
- toast;
- Result Card;
- multi-step flow.

This classification is finalized in UI-8 and then applied mechanic by mechanic.

## 10. Privacy-sensitive UI surfaces

Current privacy enforcement is anchored in state-projection.js.

High-risk surfaces during redesign:

- other-player ducats/debt;
- characters;
- active assignment;
- active expedition;
- private cards/abilities/stored benefits;
- hidden garrisons;
- derived defense values that could reveal hidden garrison;
- Scout temporary reveal;
- pending private decisions;
- random-source internals;
- persistence-only fields.

Rule:
new UI components must consume viewer-projected room state. They must not fetch or derive forbidden values from broader room state.

UI tests must retain visibility/security regressions as the presentation changes.

## 11. Own island/economy command dependencies

Current island renderer combines many mechanics that the future object sheet must preserve:

- resource/cargo loading;
- building;
- building upgrades;
- Land Company creation;
- Palace use;
- contextual costs/constraints;
- action consumption;
- faction/enemy interactions where relevant.

Separate server handlers also support:
- city guard;
- permanent garrison;
- bastion;
- other development paths.

The future compact island sheet must not attempt to display every management detail at once. Expanded island management owns the full command set.

Removal gate: UI-10, after command-coverage tests prove parity.

## 12. Fleet/Citadel command dependencies

Current fleet/trade UI mixes:

- ship stats;
- ship level;
- upgrades;
- escorts;
- character acquisition/replacement;
- character abilities;
- cargo;
- Citadel-only actions;
- Land Company-related state.

Target split:
- fleet details via HUD/fleet sheet;
- cargo via cargo sheet;
- character usage contextually;
- ship development and escorts through Citadel;
- score values outside the fleet HUD.

Removal gate: UI-14/UI-15/UI-26.

## 13. Legendary/benefit digital-native caution

Current client still presents several digital-native resources with card-like visuals and names.

The redesign may keep card presentation, but must preserve current authoritative digital-native state.

Do not infer that a visible “card” requires:
- a legacy deck;
- hidden physical top-card state;
- legacy discard mechanics;
- client-owned randomization.

Random sources and authoritative state remain backend concerns.

## 14. Current pre-game/entry surfaces

Current non-game surfaces include:

- auth panel;
- account bar;
- profile;
- admin panel;
- entry/create/join;
- My Games;
- PWA install;
- spectator banner;
- room/lobby controls.

These are not part of the first fullscreen gameplay-shell replacement and must remain functional while gameplay UI migrates.

They receive their coherent visual/UX refactor in UI-30, not opportunistically in earlier gameplay blocks.

## 15. Legacy mobile architecture removal checklist

The following cannot be deleted until UI-32 and its prerequisites are complete:

- four-tab mobile nav;
- gameSidePanel mechanics container;
- old controls panel;
- event panel;
- politics panel;
- correction/adjustment panels;
- assignment panel;
- legendary places/cards panels;
- fleet panel;
- trade panel;
- anchor panel;
- island panel;
- combat panel;
- alliance panel;
- in-game players panel;
- end-game panel in its current form;
- duplicate mobile action dock;
- current mechanic-specific CSS tied exclusively to those panels.

Deletion is a cleanup step, not an early milestone.

## 16. Migration safety strategy

For each mechanic migration:

1. identify current renderer and commands;
2. add replacement UX using the same projected state and same server commands;
3. add/adjust tests for the new path;
4. verify reconnect/waiting/privacy behavior;
5. disable old path only when replacement parity is demonstrated;
6. remove old renderer/panel only at its declared removal gate.

Avoid maintaining two competing client rule engines.

## 17. UI-1 acceptance

UI-1 is complete when:

- current permanent gameplay panels are inventoried;
- current renderers are inventoried;
- player-facing command families are inventoried;
- mandatory decisions are identified;
- privacy-sensitive surfaces are identified;
- every old major panel has a declared target UX;
- every old major panel has a safe removal gate;
- pre-game/admin surfaces are explicitly protected from accidental early removal.

This document is the migration checklist used by later UI stages.


## UI-32 cleanup status

The obsolete mobile mechanic-tab architecture is removed from the player-facing runtime:

- no bottom Map / Actions / Ship / Players navigation;
- no duplicate mobile action dock;
- HUD and map context open map-first object sheets, overlays, targeting, or the Decision Layer;
- mandatory decisions remain server-state driven;
- the pre-game lobby remains a dedicated state rather than a gameplay tab.

The legacy side-panel DOM is intentionally retained only as an internal canonical action host where migrated object sheets still reuse existing legality checks and socket payloads. It is no longer a mobile navigation surface. Removing those internal hosts before extracting their canonical action builders would duplicate rule logic, so that internal refactor is outside UI-32 and must not change mechanics.
