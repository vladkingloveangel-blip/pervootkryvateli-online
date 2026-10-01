# UI state-to-presentation contract

Status: UI-2 canonical contract.
Depends on:
- docs/mobile-ui-ux-spec.md
- docs/current-ui-migration-audit.md

Purpose: define what the client should present for every meaningful game state without inventing new game rules or duplicating backend authority.

## 1. Precedence model

The UI resolves the visible state in this priority order:

1. finished game;
2. mandatory viewer decision;
3. mandatory waiting for another player's decision;
4. active battle/alliance orchestration;
5. event-phase orchestration;
6. ordinary active turn;
7. ordinary non-active-player waiting;
8. pre-game lobby.

Higher-priority states suppress unrelated lower-priority voluntary controls.

A bottom sheet opened by the player is navigation state and may be closed. A mandatory Decision Layer is game state and may not be dismissed unless the canonical choice itself allows cancellation.

## 2. Shared presentation zones

Every gameplay state is expressed through these zones:

- Map: permanent gameplay space unless final results replace it.
- HUD: identity/resources/round/circle/turn/phase.
- Roster: compact public player presence/status.
- Action Bar: next legal/expected interaction for the viewer.
- Object Sheet: optional user-opened contextual information.
- Decision Layer: mandatory viewer choice.
- Result Layer: important outcome acknowledgement.
- Ambient Layer: toast/short public notices.
- Goal Tracker: private owner-only assignment/expedition summary.
- Menu: secondary navigation.

## 3. Pre-game lobby

Server indicators:
- room.started !== true;
- room.finished !== true.

HUD:
- gameplay HUD is not required as the dominant element;
- room identity/invite state may remain visible.

Map:
- not required to be the primary interaction surface before start.

Primary UI:
- player roster;
- host/leader status;
- seating/order controls where authorized;
- ship selection;
- ready state;
- start-game control for authorized host;
- invite/share;
- leave/close room as appropriate.

Blocking:
- gameplay commands unavailable.

Reconnect:
- restore lobby membership, chosen ship, ready state, leader/seating information from room state.

Future migration owner: UI-30.

## 4. Finished game

Server indicators:
- room.finished === true OR room.phase === 'finished';
- finalResult present for canonical finished room.

Primary surface:
- dedicated final results screen replaces map as primary content.

HUD/action bar:
- ordinary gameplay HUD and action controls suppressed.

Show:
- finished round;
- six canonical titles;
- shared title holders equally;
- final player metrics.

Do not show:
- overall winner;
- podium/ranking implying an overall champion;
- gameplay controls.

Allowed lifecycle controls:
- return/home;
- room/lifecycle operations already permitted by finished-game lock.

Reconnect:
- immediately render final results from finalResult without recomputation.

Future migration owner: UI-29.

## 5. End-game proposal pending

Server indicators:
- endGameConsensus.status === 'proposed'.

For a player who has not confirmed:
- global consensus Decision Layer appears;
- proposer name;
- confirmation count;
- confirm;
- reject where canonical rules permit.

For proposer/already-confirmed player:
- non-dismissible consensus status card or compact global status;
- no duplicate confirmation action;
- clear “waiting for other players” state.

For spectator:
- read-only consensus status.

Map:
- remains visible behind consensus layer.

Ordinary gameplay:
- proposal itself does not end the current turn or consume an action;
- once the viewer has handled any required response, gameplay remains governed by the underlying phase.

Reconnect:
- reconstruct consensus UI from endGameConsensus.

Future migration owner: UI-28.

## 6. Accepted end-game consensus / last round

Server indicators:
- endGameConsensus.status === 'accepted';
- finishAfterRound set;
- room not yet finished.

HUD:
- prominent but compact LAST ROUND / game ends after round N state.

Decision Layer:
- none for consensus;
- accepted decision is irreversible.

Gameplay:
- normal current phase continues;
- normal turn/action UI remains available.

Finalization:
- only changes to final results state at canonical round boundary.

Future migration owner: UI-28.

## 7. Ordinary non-active player waiting

Server indicators:
- room.started;
- not finished;
- no higher-priority pending/waiting state for viewer;
- room.activePlayerId !== viewer id.

HUD:
- round/circle;
- current phase;
- “X's turn”.

Map:
- fully inspectable subject to normal interaction policy;
- public objects selectable;
- no commands that require active turn.

Action Bar:
- passive status such as “Alex is navigating” / “Alex is taking actions”;
- no misleading disabled forest of buttons.

Allowed:
- secondary information views;
- Menu;
- public player/object inspection;
- any canonical out-of-turn reaction only if a higher-priority server pending state is actually present.

Future migration owner: UI-6/UI-12.

## 8. Active turn: navigation before roll

Server indicators:
- room.activePlayerId === viewer;
- room.phase === 'navigation';
- owner player.roll === null;
- no blocking pending.

HUD:
- YOUR TURN;
- NAVIGATION;
- current effects relevant to movement may be summarized.

Map:
- normal map;
- no reachable destination highlight yet.

Action Bar:
- primary Roll;
- secondary Stay;
- contextual character action if legal before roll (for example Cartographer);
- show no unrelated island/combat action controls.

Character context:
- Cartographer may enter targeting mode;
- other pre-roll legal effects may appear only if server-projected state says they are available.

Reconnect:
- same pre-roll state based on phase + roll null.

Future migration owner: UI-6/UI-14.

## 9. Active turn: navigation after roll

Server indicators:
- active viewer;
- room.phase === 'navigation';
- owner roll !== null;
- movePoints available.

HUD:
- YOUR TURN / NAVIGATION.

Map:
- highlight projected reachableCells;
- legal destinations are interactive;
- illegal destinations are not presented as actions.

Action Bar:
- show roll result;
- show effective range;
- instruction: choose destination;
- Stay remains available if canonical;
- Navigator reroll appears when legal.

Selection:
- safe destination tap may move directly;
- optional confirmation only for future specifically high-impact/ambiguous contexts, not as a blanket requirement.

Reconnect:
- restore highlights from projected reachableCells and current roll/movePoints.

Future migration owner: UI-6/UI-13/UI-14.

## 10. Navigation disabled by effect

Server indicators:
- active viewer;
- server has advanced room.phase to 'actions' because noNavigation effect applies.

Presentation:
- do not simulate a “disabled roll” screen;
- Action Bar directly shows ACTIONS;
- Result/Ambient feedback may explain that navigation was skipped due to the named effect if viewer is allowed to know it.

Future migration owner: UI-6/UI-8.

## 11. Active turn: actions phase

Server indicators:
- active viewer;
- room.phase === 'actions';
- no blocking pending.

HUD:
- YOUR TURN / ACTIONS;
- remaining actions.

Action Bar:
- action-count indicator;
- End Turn;
- highest-priority context action(s) derived from selected/current map object and projected legality.

Map:
- normal object interaction;
- current cell/object may be visually emphasized.

Contextual sources:
- own island;
- Citadel;
- anchor;
- state island;
- other ship;
- other island;
- legendary place;
- character/card/goal actions.

Rule:
- do not display one global list of every mechanic in the game.

Future migration owner: UI-6 through object/mechanic stages.

## 12. Active turn: zero actions remaining

Server indicators:
- phase === 'actions';
- actionsLeft <= 0;
- no blocking pending.

Action Bar:
- End Turn becomes dominant;
- zero-action informational state;
- do not offer actions that require an action.

Zero-cost canonical actions:
- may remain available only if backend actually permits them.

Future migration owner: UI-6.

## 13. Event phase: general

Server indicators:
- room.phase === 'event';
- eventPhase active / PreTurnResolutionFlow active.

HUD:
- EVENT PHASE;
- current player receiving/resolving cards where public;
- ordinary action count hidden/suppressed.

Action Bar:
- ordinary navigation/actions bar removed;
- compact event progress/status.

Map:
- remains background space;
- may dim during a foreground event/decision.

Canonical event-flow stages:
- sailing;
- political (presented to player as Feud/state consequence, not technical “political queue”);
- assignment.

Player-facing progress language:
- Event;
- Feud;
- Assignment.

Do not expose:
- raw queue indices;
- replacement/index internals;
- random-source internals.

Future migration owner: UI-21/UI-22.

## 14. Event phase: event belongs to viewer and resolves automatically

Server indicators:
- eventPhase points to viewer;
- no pendingEvent remains after automatic resolution.

Presentation:
- Event Card / Result Card explains the event and effect;
- Continue acknowledgement may be used for meaningful events;
- small effects may use a lighter result treatment if they do not need interruption.

Important:
- server has already resolved canonical mechanics;
- UI is presenting the outcome, not delaying backend resolution unless the existing server flow itself is pending.

This reveals a later implementation need: reliable result/outcome envelopes may need presentation metadata derived from authoritative transitions, but rules must not move client-side.

Future migration owner: UI-8/UI-21.

## 15. Event phase: viewer has pendingEvent

Server projection:
- viewer receives pendingEvent with viewerCanRespond true.

Decision Layer:
- event title/cardName;
- concise reason;
- legal options only from projected pending data;
- spatial options can transition into targeting mode if appropriate.

Examples include:
- Observatory keep/replace;
- cargo hold choice;
- event target choice;
- other canonical event decisions.

Blocking:
- unrelated voluntary controls suppressed.

Reconnect:
- pendingEvent reconstructs same Decision Layer.

Future migration owner: UI-7/UI-21.

## 16. Event phase: another player has private pending decision

Server projection:
- viewer does not receive private pending content;
- viewer may receive pendingDecision.waiting + actorPlayerId.

Presentation:
- no leaked card/choice/type;
- generic waiting UI: “Waiting for Alex's decision.”

HUD/event progress:
- may identify the actor if projection allows;
- must not infer the private decision category.

Future migration owner: UI-7/UI-22.

## 17. Pending feud: viewer actor

Server projection:
- pendingFeud with viewerCanRespond.

Decision Layer:
- state/faction context if projected;
- card name if projected;
- legal options;
- any removal/downgrade/goods choice exactly as server supplies.

Blocking:
- full unrelated gameplay block.

Reconnect:
- exact current decision restored.

Future migration owner: UI-7/UI-22.

## 18. Pending assignment choice: viewer actor

Server projection:
- pendingAssignmentChoice;
- currently includes embassy choice options.

Decision Layer:
- “Choose assignment”;
- faction context;
- each projected option text/reward/type;
- no legacy paid replacement UI.

After resolution:
- Goals view becomes the persistent home for the active assignment;
- a result/received-goal presentation may acknowledge assignment acquisition.

Future migration owner: UI-7/UI-17/UI-22.

## 19. Pending island correction: viewer actor

Server projection:
- pendingIslandCorrection.

Decision Layer:
- explain why island state is invalid;
- show projected constraint report;
- show legal building-removal choices;
- show required number of removals/retention choices where relevant.

Map:
- may center/highlight affected island;
- background interaction blocked.

Reconnect:
- restore remaining correction state and already removed items if projected.

Future migration owner: UI-7.

## 20. Pending fleet adjustment: viewer actor

Server projection:
- pendingFleetAdjustment.

Known stages:
- upgrades;
- escorts;
- bastions;
- landin-replace;
- shipyard-remove.

Decision Layer copy adapts to stage:
- choose inactive upgrades;
- choose inactive escorts;
- choose unsupported bastions;
- choose escort replaced by Landin reward;
- choose excess escort(s) to remove.

If cargo loss is projected:
- explain it before confirmation.

Background:
- fleet/ship context may be visible but unrelated controls blocked.

Future migration owner: UI-7.

## 21. Pending legendary reaction: viewer actor

Server projection:
- pendingLegendaryReaction to target viewer.

Decision Layer:
- explain incoming canonical threat at the level allowed by projection;
- offer only projected veil/reaction options;
- accept/decline reaction.

Privacy:
- other players receive generic waiting rather than reaction inventory.

Future migration owner: UI-7/UI-16.

## 22. Alliance proposal: recipient

Server indicator:
- pendingAlliance;
- projected viewerRole identifies recipient/participant where applicable.

Decision Layer:
- proposer;
- alliance proposal;
- Accept;
- Reject.

No need for permanent Alliance panel.

Future migration owner: UI-7/UI-24.

## 23. Alliance proposal: proposer/waiting viewer

Presentation:
- proposer sees “Waiting for X” and cancel if canonical command remains legal;
- unrelated players see only permitted public envelope or no detailed overlay depending projection.

Gameplay blocking:
- current backend treats pendingAlliance as a gameplay blocker, so UI must reflect that rather than implying actions remain available.

Future migration owner: UI-24.

## 24. Pending battle: invited viewer

Server projection:
- pendingBattle;
- invites include viewer-specific status/public envelope;
- viewerInvite where available.

Decision Layer:
- battle context;
- side;
- participate / decline.

Do not expose hidden invitation/private combat data beyond projection.

Future migration owner: UI-7/UI-19.

## 25. Pending battle: initiator or waiting participant

Presentation:
- battle flow remains foreground;
- list public/invited response statuses the server projects;
- explain who is still awaited without exposing hidden details;
- ordinary gameplay controls blocked because backend blocks during pending battle.

When all answers resolve:
- transition to Result Card if the battle resolves immediately.

Reconnect:
- reconstruct pending battle flow from pendingBattle.

Future migration owner: UI-19.

## 26. Anchor available during actions

Server indicators:
- active viewer;
- phase actions;
- player on anchor;
- anchor not already consumed for round;
- actions available;
- no blocker.

Map:
- anchor selectable/highlightable contextually.

Anchor sheet:
- anchor identity;
- any public rules/known context;
- primary “Enter battle”/encounter action.

After fightAnchor:
- do not rely only on updated ducats/fleet score;
- show encounter result using Result Card/flow.

Future migration owner: UI-18.

## 27. Anchor already visited

Server owner projection includes visitedAnchors / lastAnchorEncounter.

Anchor sheet:
- clearly show already resolved for this round;
- no active fight button;
- may show owner's last known encounter summary if projection allows.

Future migration owner: UI-18.

## 28. Own island selected

Presentation depends on phase and location.

Always:
- own public/private island data available to owner;
- buildings/resources/area/status;
- full own garrison/defense where projected.

When active viewer is present and action legal:
- build;
- upgrade;
- load;
- Land Company;
- Palace;
- garrison/bastion development paths as applicable.

When not legal:
- actions hidden or shown as informational disabled states only when reason is useful.

Expanded sheet owns management complexity.

Future migration owner: UI-10.

## 29. Other island selected

Show only projected data.

Possible contextual actions when canonical:
- assault;
- state/political interaction;
- other future public interactions.

Hidden garrison rule:
- if projection does not include garrison/private defense, no UI-derived total may reveal it.

Scout reveal:
- if server projection now includes temporary privateGarrison fields for viewer, show “Scouted until end of your turn”.

Future migration owner: UI-11/UI-20.

## 30. Citadel selected

Show:
- peace-zone/service identity;
- current cargo sale opportunity;
- ship development;
- upgrades;
- escorts;
- other canonical Citadel-only services.

During wrong phase/not active:
- informational sheet remains inspectable;
- transactional controls absent or clearly unavailable.

Future migration owner: UI-15.

## 31. Other player/ship selected

Show:
- public player identity;
- projected ship class/level;
- projected public combat/cargo data;
- alliance/hostility relation;
- public statuses.

Contextual actions:
- alliance proposal;
- break alliance at canonical timing;
- attack when legal.

Never show private owner fields unless Scout money projection explicitly grants ducats.

Future migration owner: UI-12/UI-19/UI-24.

## 32. Scout: mode selection

Entry:
- character context from HUD/fleet sheet;
- only when useScout is canonically available.

Step 1 Decision/mini-sheet:
- Garrison;
- Treasury.

Step 2:
- reusable targeting mode.

Garrison mode:
- highlight legal islands within canonical Manhattan range.

Treasury mode:
- highlight legal other players/ships within canonical Manhattan range.

After selection:
- existing useScout command;
- result confirmation;
- projected temporary reveal appears on target card.

Reconnect:
- reveal survives only according to canonical server grant duration;
- targeting selection itself does not need to survive if command was not sent.

Future migration owner: UI-13/UI-14.

## 33. Cartographer targeting

Server owner projection:
- cartographerAnchorOptions.

Before roll:
- character action enters targeting mode;
- highlight only projected legal anchors;
- choose anchor -> useCartographer;
- private peek result displayed to owner.

No need to derive Manhattan legality client-side beyond presentation of projected options.

Future migration owner: UI-13/UI-14.

## 34. Navigator after roll

Conditions are already server-enforced.

Presentation:
- after-roll navigation Action Bar offers “Reroll” when character and action budget make it meaningful;
- explain second result is mandatory before activation if needed;
- useNavigator updates roll/range;
- refreshed reachableCells become map targets.

Future migration owner: UI-14.

## 35. Treasure Hunter flow

When invoked:
- short flow/Decision Layer presents the two canonical generated results;
- player chooses one;
- selected result receives Result Card if consequential.

The UI must not generate random outcomes.

Future migration owner: UI-14/UI-8.

## 36. Cards/abilities available

Cards entry shows owner-only projected resources.

Each resource:
- available -> clear use action;
- unavailable -> reason when this can be safely derived from projected state or provided by backend;
- targeting card -> enters targeting mode;
- reactive card -> normally appears automatically via Decision Layer at reaction time.

No other player sees private inventory/count unless policy allows it.

Future migration owner: UI-16.

## 37. Active assignment

Owner-only Goals:
- assignment text;
- faction;
- reward;
- progress;
- current next step.

Optional private tracker:
- concise next objective.

No other player receives existence signal unless current projection explicitly exposes it.

Future migration owner: UI-17.

## 38. Active expedition

Owner-only Goals:
- expedition/place;
- progress / leave-and-return requirement;
- reward framing where canonical.

Map:
- target legendary place may receive owner-only target styling.

Arrival/completion:
- Result Card;
- treasure sub-flow if a pending cargo choice follows.

Future migration owner: UI-17/UI-8.

## 39. Legendary place selected

Show public place information.

If owner has active expedition to this place:
- owner-only goal relevance.

On first discovery/completion:
- Result Card describing named-place/legendary reward as projected/returned by authoritative state.

Future migration owner: object framework + UI-17/UI-16.

## 40. Vassal / state interaction

HUD:
- suzerain emblem/status when owner has suzerain.

State-island sheet:
- enter vassalage when legal;
- assault state island when legal.

Suzerain detail:
- relation;
- public/owner-visible tax context;
- gifted island;
- rebellion action when legal.

Global overview:
- Menu -> Diplomacy.

Future migration owner: UI-23.

## 41. Disconnected own client

Local transport state:
- connection banner above gameplay shell;
- do not pretend actions succeeded;
- retain last rendered map visually if helpful;
- primary controls disabled until authoritative reconnect.

After reconnect:
- discard assumptions based solely on local modal/action state;
- render fresh server projection and recompute presentation state by this contract.

## 42. Other player disconnected

Roster:
- public disconnect indicator.

Do not automatically convert disconnect into a special gameplay UI unless backend state has done so.

Consensus note:
- disconnected players remain required for end-game consensus according to canonical backend behavior.

## 43. Spectator/admin view

Spectator:
- map and public/admin-authorized information;
- no player action bar;
- no actor Decision Layer actions;
- read-only event/battle/consensus status as allowed.

Admin observation may have broader data than ordinary players, but ordinary mobile UX must never be designed using admin-only fields as dependencies.

## 44. Result Card triggering principle

A later UI implementation needs a stable presentation mechanism for events that are currently only visible as immediate state mutations/log entries.

Until such mechanism is designed, do not move rule resolution client-side.

Candidate significant outcomes:
- anchor fight result;
- sea battle result;
- assault result;
- island acquisition;
- expedition completion;
- assignment completion;
- major treasure result;
- major event movement/loss/reward;
- ship level loss/gain;
- significant building/status change;
- political transition.

Minor examples for toast:
- small payment/income;
- routine cargo transfer;
- simple purchase confirmation where sheet already shows context.

Exact classification is UI-8 work.

## 45. Object sheet versus Decision Layer

Object Sheet:
- opened voluntarily;
- dismissible;
- informational/contextual;
- map remains interactive as appropriate.

Decision Layer:
- caused by authoritative pending state;
- foreground priority;
- cannot be dismissed to bypass decision;
- unrelated actions blocked.

Result Card:
- informs about completed important outcome;
- normally acknowledge/continue;
- does not create a new game choice unless server state also contains a pending decision.

This separation must remain architectural, not only visual.

## 46. Client-local states that are not game states

Current client has local values such as:
- selected island/map selection;
- zoom;
- mobile tab;
- map move pending;
- character peek;
- temporary UI selection for fleet adjustment;
- mist-card local reference.

During redesign these must be classified:

Safe local navigation state:
- zoom;
- open/closed sheet;
- selected public object;
- menu page.

Potentially dangerous local flow state:
- target mode;
- unsent mandatory-choice selection;
- local references to card/ability being used.

Rule:
local state may assist interaction, but authoritative legality/current pending must always come from latest server projection.

## 47. State-to-UI implementation function

Future implementation should converge on a deterministic presentation resolver conceptually equivalent to:

resolvePresentation(room, viewer, localNavigationState)

returning:
- mode;
- HUD model;
- action-bar model;
- mandatory decision model or null;
- waiting model or null;
- event-phase model or null;
- map interaction mode;
- available overlay type;
- safe sheet context.

This does not calculate game legality. It translates already-projected state into presentation priority.

The resolver should be testable without a browser.

## 48. UI-2 acceptance

UI-2 is complete when the new frontend architecture has an explicit presentation definition for:

- lobby;
- finished;
- end-game proposed/accepted;
- own navigation before/after roll;
- own actions;
- other-player turn;
- event phase;
- all currently projected pending families;
- alliance pending;
- battle pending;
- islands;
- players/ships;
- Citadel;
- anchors;
- characters/targeting;
- Cards;
- Goals;
- politics;
- disconnect/reconnect;
- spectator;
- privacy-sensitive waiting.

No implementation change is made in UI-2.
