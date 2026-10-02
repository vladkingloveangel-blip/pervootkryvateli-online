# Mobile UI/UX specification

Status: canonical direction for the next frontend refactor.
Scope: presentation and interaction only. Game rules, scoring, visibility policy, server-authoritative state and canonical backend flows remain unchanged unless a separate rules change is explicitly approved.

## 1. Product direction

«Первооткрыватели» is designed mobile-first for portrait 9:16.

Desktop is a later expansion of the same UX system, not a second product architecture.

The map is the permanent gameplay space. It is not a panel inside a larger interface. HUD, actions, notifications, floating information windows, overlays and temporary flows are layered over the map.

Core player loop:

current state -> required action -> available destination/target -> local action -> explicit outcome -> next state.

A player should not need to remember which technical panel contains a mechanic.

## 2. Non-negotiable implementation constraints

- Keep the current server-authoritative game model.
- Keep canonical rules and probabilities unless a separate rules task changes them.
- Keep state projection and privacy enforcement server-side.
- Keep current save/migration model and finished-state semantics.
- Keep current map data/layers, reachable-cell logic, zoom and centering where compatible.
- New UI must consume existing projected state and existing commands.
- Do not re-create removed physical deck/card architecture merely because the UI uses a card visual metaphor.
- Critical UI state must be reconnect-safe. Refresh/reconnect reconstructs the correct UI from server state.
- Old UI is removed only after the replacement path fully covers the same gameplay behavior.
- Production must remain playable after each migration block.

## 3. Base mobile shell

Primary gameplay surface:

- fullscreen/permanent top-down map;
- compact top HUD over the map;
- context-sensitive bottom action bar;
- compact entry points for Cards, Goals and Menu;
- floating object/information windows;
- Decision Layer for mandatory choices;
- Result Cards for meaningful outcomes;
- lightweight toasts/ambient notifications for minor outcomes.

The map should normally remain visible in the background. No fixed percentage such as 75-85% is canonical; overlays and expanded sheets may temporarily occupy more space when the situation requires it.

Final results are an exception: after the game is finished, the dedicated results screen replaces the map as the primary screen.

## 4. Top HUD

Always-visible information should be limited to what helps moment-to-moment play:

- player identity;
- ship class and level;
- ducats;
- glory;
- cargo usage;
- actual army/boarding strength;
- actual artillery strength;
- round;
- circle;
- active player / “your turn” state;
- current phase.

Scoring metrics must not be visually mixed with combat characteristics.

Army points, fleet points, prestige, wealth, islands and legendary-place score belong in a separate game metrics view.

HUD elements are interactive:

- player/ship -> fleet sheet;
- cargo -> cargo section;
- character -> character details;
- active effect -> effect details;
- suzerain emblem -> politics/suzerain card.

## 5. Bottom action bar

The action bar is the main control surface and is derived from the current server state.

Examples:

Before navigation roll:
- NAVIGATION
- Roll
- Stay

After roll:
- roll result;
- effective range;
- instruction to choose destination;
- map highlights only legal cells.

After movement:
- remaining action indicators;
- highest-priority contextual actions.

During event phase:
- ordinary action bar is replaced by event-phase state/progress.

During waiting:
- clear human-readable status explaining who/what is awaited.

The client must not duplicate backend legality rules as a second authority.

## 6. Map object interaction

Primary interactions start from map objects.

Tap:
- own island -> own island window;
- other player's island -> visible island window;
- state island -> political/context window;
- own ship -> fleet/player window;
- other ship -> public player window;
- anchor -> sea encounter window;
- legendary place -> legendary-place window;
- Citadel -> service window.

The player should not need to open a general mechanic tab to interact with an object already visible on the map.

## 7. Floating information window framework

Floating windows are the default secondary-information pattern on mobile.

Required behavior:
- compact window layered over the permanent map;
- consistent title bar with context label, title and explicit close button;
- internal scrolling when content exceeds the window height;
- optional tabs or secondary controls inside the same window when a view has several information groups;
- no bottom-edge attachment or drag-handle metaphor;
- preserve visible map context around the window;
- optional map centering on the selected object;
- contextual actions based on current server state;
- safe-area support;
- one shared visual language for object information, metrics, journal and secondary menu surfaces.

Mandatory choices are not information windows: they continue to use the separate Decision Layer. Desktop may later render the same conceptual window as a larger floating window or side panel.

## 8. Own islands

Compact window:
- name;
- ownership;
- settlement/city/major-port state;
- known defense;
- area used/available;
- resources;
- concise building list;
- immediately legal contextual actions.

Detailed management view inside the same window:
- all buildings and levels;
- next upgrades;
- costs;
- area;
- branch constraints;
- resources;
- garrison;
- bastion/support information;
- legal actions.

A separate “My holdings” overview is secondary navigation, not a primary gameplay tab.

Selecting an island from that overview centers the map and opens its window.

## 9. Other islands and privacy

UI renders only fields already allowed by server projection.

If hidden garrison information is not visible, the UI must not expose a derived total that allows it to be calculated.

Temporary Scout reveal may show the explicitly revealed value only to the authorized viewer and only for its canonical duration.

No CSS-only hiding of sensitive values. Unauthorized data should not be present in the projected payload.

## 10. Other players and roster

Use a compact horizontal roster of player tokens/initials/colors on mobile.

Indicate only allowed public statuses such as:
- active player;
- alliance;
- disconnect;
- other explicitly public state.

Tap a player token/ship to open the public player card.

Public player card may show projected public ship/combat/cargo/relationship information.

It must not reveal private treasury, held character, active assignment, active expedition, private cards/abilities, debt or other private state unless current projection explicitly authorizes it.

## 11. Targeting mode

Create one reusable map targeting mode.

While active:
- only valid targets are highlighted;
- irrelevant targets are visually suppressed/non-interactive;
- current targeting purpose is explained;
- cancel is always available unless the server flow itself is mandatory;
- selection submits the existing canonical command.

First consumers include:
- Scout;
- Cartographer;
- events requiring target selection;
- legendary effects;
- selected battle/assault flows where useful.

## 12. Characters

Characters are contextual capabilities, not a permanent panel.

Examples:
- Navigator -> reroll action appears after a navigation roll when legal;
- Cartographer -> available before roll and enters anchor targeting;
- Treasure Hunter -> presents its two-result choice when invoked;
- First Mate -> action-related control appears when usable;
- Ship Carpenter -> appears only in flows where level-loss prevention is relevant.

Character details remain accessible through HUD/fleet information.

## 13. Citadel

Citadel is a map service hub.

Its window may provide:
- cargo selling;
- ship level development;
- upgrades;
- escorts;
- other canonical Citadel services.

Detailed ship development opens a detailed window/flow rather than a permanent global panel.

## 14. Cards UX

“Cards” is a player-facing UX category, not permission to restore legacy deck architecture.

It may visually contain current digital-native consumable abilities, stored benefits, legendary resources/effects or other card-like player resources.

Owner may see unavailable owned resources with an exact reason they cannot currently be used.

Other viewers see only what current visibility policy permits, including whether counts are public or private.

## 15. Goals UX

Goals contains:
- active suzerain assignment;
- active expedition;
- progress;
- conditions;
- reward;
- completed-history information that is canonical to show.

Assignment and expedition privacy remains server-projected.

A compact private tracker may be shown over the map to the owner.

## 16. Combat and assault flows

Combat is a short orchestration flow over existing mechanics, not a new combat system.

Sea battle flow can include:
- select target;
- show currently known relevant strengths;
- invite eligible allies;
- offer legal reactions;
- confirm attack/action cost;
- wait for required responses;
- resolve using existing backend;
- show explicit result.

Island assault follows the same UX principle through the island context.

Unknown/private defense information remains unknown where rules require it.

## 17. Events and event phase

Events should feel like game events, not technical panels.

A significant event:
- dims or visually deemphasizes the map;
- presents a readable event card;
- explains what happened;
- explains consequences;
- asks for a choice only when a choice exists;
- enters targeting mode when spatial selection is required;
- produces a clear outcome before continuing where appropriate.

During the global event phase, show human-readable progress such as:
Event -> Feud -> Assignment

Do not expose technical queue indexes or orchestration internals.

## 18. Unified Decision Layer

One mandatory-choice system handles current and future pending decisions.

Canonical examples:
- pending event;
- feud;
- assignment choice;
- island correction;
- fleet adjustment;
- legendary reaction;
- alliance response;
- battle invite;
- treasure choice;
- other blocking decisions.

Decision Layer format:
- “Your decision is required”;
- reason/context;
- concise consequences where useful;
- legal options.

While a mandatory decision is unresolved, unrelated voluntary gameplay controls are blocked.

Reconnect must reconstruct the same pending decision from server state.

## 19. Outcome hierarchy

Not every state change opens a modal.

Use three levels:

1. Toast / ambient feedback:
small, low-risk changes that do not require acknowledgement.

2. Result Card:
important result that the player should explicitly understand.

3. Flow/Scene:
multi-step sequence involving decisions, waiting, reactions or several consequential transitions.

Decision Card asks.
Result Card informs.

Examples for Result Cards:
- battle victory/defeat;
- significant sea encounter;
- assignment completion;
- expedition completion;
- major reward/loss;
- island capture;
- major settlement/status change.

Avoid modal fatigue.

## 20. Politics and alliances

No permanent politics or alliance gameplay tab.

Contextual actions live on relevant state islands/player cards.

Suzerain relation may be accessible through a HUD emblem/status.

Global politics overview belongs in Menu -> Diplomacy.

Alliance proposal is delivered through Decision Layer.

Current alliance status is shown compactly where public.

## 21. Menu

Menu contains secondary/non-immediate functions:
- game metrics;
- my holdings;
- diplomacy;
- journal;
- rules/help;
- propose end game;
- settings;
- leave/exit where appropriate.

The ordinary turn must not require hunting through Menu for routine gameplay.

## 22. Game metrics

Separate view for:
- islands;
- wealth;
- army points;
- fleet points;
- prestige;
- legendary places.

Before finalization, display only values allowed by current visibility rules.

Finished-state metrics come from canonical finalResult.

## 23. Journal and ambient notifications

The full journal is secondary and opens from Menu.

Short public events may appear as non-blocking ambient notifications over the map.

The journal must not be the primary mechanism for understanding a just-completed action.

## 24. End-game consensus

“Propose end game” lives in Menu.

When proposed, players receive a global consensus card with:
- proposer;
- confirmation count;
- confirm/reject controls for eligible viewer state.

After unanimous acceptance, HUD clearly indicates the last round / finish-after-round state while normal gameplay continues to the canonical round boundary.

Do not change end-game backend rules.

## 25. Final results

After canonical finalization, show a dedicated final results screen.

No overall winner and no 1/2/3 podium.

Show six canonical titles:
- Master of Holdings;
- Master of Treasury;
- Master of Army;
- Master of Fleet;
- Master of Prestige;
- Master of Legendary Places.

Shared holders are displayed equally.

Show final canonical player metrics below.

Reconnect to a finished room opens this screen directly.

## 26. Lobby and pre-game

The redesign also covers:
- authentication/entry presentation;
- room creation/join;
- invite/share;
- 2-6 players;
- ship choice;
- seating/order;
- leader;
- ready state;
- reconnect;
- spectator/admin paths where applicable.

Pre-game UX must eventually use the same visual system but does not need to share the gameplay map shell when that would be unnatural.

## 27. Reconnect and state restoration

Critical rule:

UI navigation state may be local.
Game-critical state must be reconstructed from the server.

On reconnect/refresh, client must correctly restore:
- phase;
- active player;
- remaining actions;
- legal navigation;
- mandatory decisions;
- battle waiting;
- event-phase progress;
- accepted end-game consensus;
- finished-state results;
- temporary server-authorized reveals that canonically survive reconnect.

Do not depend on a locally remembered modal being open.

## 28. Mobile interaction rules

- Portrait 9:16 is primary.
- Respect safe areas.
- Primary controls must be reachable and large enough for touch.
- Do not require hover.
- Avoid repeated confirmation for harmless reversible interactions.
- Require confirmation for materially irreversible/high-impact actions where accidental activation is plausible.
- Ordinary safe movement does not require a second confirmation by default; confirmation may be used for high-impact/ambiguous movement contexts.
- Keyboard/open browser chrome must not hide mandatory actions.

## 29. Desktop expansion

Desktop uses the same interaction model.

Possible expansions:
- bottom sheet -> side panel;
- wider HUD;
- expanded roster;
- persistent goal tracker;
- more simultaneous secondary information.

Do not create desktop-only game logic or a separate information architecture.

## 30. Visual direction

Theme:
- Age of Exploration;
- historical naval strategy;
- dark navy;
- deep teal;
- muted brass/gold;
- parchment accents;
- minimal heavy wood;
- modern clean HUD;
- no sci-fi;
- no magical-fantasy framing;
- no website/admin-dashboard feeling.

The gameplay map remains top-down.

Angled/illustrative art is appropriate for:
- events;
- battles;
- expeditions;
- legendary places;
- island cards;
- menus;
- final results.

Final art is intentionally deferred until UX architecture works with placeholders.

## 31. Migration rule

Do not replace the frontend in one commit.

Recommended high-level migration order:

1. specification and current-UI audit;
2. state-to-UI contract;
3. fullscreen map shell;
4. HUD;
5. action bar;
6. Decision Layer;
7. Result/feedback system;
8. object selection + bottom sheets;
9. islands;
10. players/roster;
11. targeting + characters;
12. Citadel;
13. Cards;
14. Goals;
15. encounters/combat/assault;
16. events/event phase;
17. politics/alliances;
18. Menu/metrics/holdings/journal;
19. end-game consensus;
20. final results;
21. lobby/pre-game;
22. reconnect/mobile hardening;
23. remove legacy UI;
24. regression/device/accessibility pass;
25. visual kit/assets;
26. motion/audio polish;
27. desktop expansion;
28. staging playtest;
29. production cutover.

Each block must leave the game in a coherent playable state.

## 32. Acceptance principle

The redesign succeeds when a mobile player can repeatedly answer, without searching through technical panels:

- What is happening now?
- What can I do now?
- What just happened?
- What do I need to do next?

The UI is a presentation of the game world and current state, not a directory of backend mechanics.
