# Unified UX event and feedback system

Status: UI-3 canonical contract.
Depends on:
- docs/mobile-ui-ux-spec.md
- docs/current-ui-migration-audit.md
- docs/ui-state-presentation-contract.md

Purpose: define one presentation system for what happens in the game so the client does not accumulate mechanic-specific popups, logs and panels.

## 1. Core model

The new frontend uses four presentation classes:

1. Toast
2. Result Card
3. Decision Layer
4. Flow

They are not visual skins for the same thing. They have different semantics.

Toast:
- informs;
- low interruption;
- no acknowledgement required;
- never carries a mandatory choice.

Result Card:
- informs about a meaningful completed outcome;
- usually requires acknowledgement;
- does not decide unresolved game state.

Decision Layer:
- asks for a canonical player choice;
- maps to authoritative pending state;
- blocks unrelated gameplay.

Flow:
- coordinates a multi-step experience made of decisions, waiting states and/or results;
- never becomes a second game engine;
- each game-critical step remains driven by server state.

## 2. Source-of-truth rule

The server remains authoritative.

The UX system may:
- choose presentation type;
- queue non-authoritative acknowledgements;
- animate;
- group related outcome text;
- preserve local “already shown” state for cosmetic purposes.

The UX system must not:
- generate random outcomes;
- calculate combat results;
- decide legality;
- create hidden state;
- resolve pending decisions locally;
- infer private information;
- delay authoritative game progression solely because a cosmetic animation has not finished.

If the backend has already changed the state, the UI presents that change. If the backend is waiting for a choice, the UI presents that choice.

## 3. Priority order

Foreground priority:

1. Finished-state final results
2. Decision Layer for the viewer
3. Flow waiting/interaction that is still authoritative
4. Result Card
5. User-opened Object Sheet
6. Toast / ambient notice

A lower-priority surface cannot cover a higher-priority mandatory surface.

Examples:
- an island sheet closes or moves behind a mandatory battle invite;
- a toast may appear above the map while no Decision Layer is active;
- a Result Card waits behind an active Decision Layer if both become relevant at the same moment.

## 4. Toast

Use Toast for small, immediately understandable outcomes.

Typical examples:
- routine income received;
- cargo loaded/sold when context is already obvious;
- small payment;
- upgrade purchase confirmation;
- alliance/public-state notification that does not need acknowledgement;
- another player built something, when publicly visible;
- reconnect restored;
- command success where no larger result presentation is justified.

Toast properties:
- short title or one-line message;
- optional value delta;
- auto-dismiss;
- tap may open related sheet/journal entry;
- never blocks controls;
- may stack only in a bounded queue.

Do not use Toast for:
- battle outcome;
- forced relocation;
- island capture;
- assignment/expedition completion;
- major loss;
- mandatory rule consequence the player could miss.

## 5. Result Card

Use Result Card when the player should explicitly understand an outcome before continuing mentally, even if the server has already completed it.

Canonical structure:
- category/kicker;
- event/result title;
- concise explanation;
- before/after or relevant numbers when useful;
- rewards/losses;
- optional source/cause;
- Continue.

Examples:
- “Storm — your ship was carried to Renaika.”
- “Convoy defeated — +8 ducats, +1 fleet point.”
- “Island captured.”
- “Assignment completed — +12 ducats.”
- “Expedition completed.”
- “Ship lost one level.”
- “Legendary place discovered.”
- “Vassalage entered / rebellion declared” when significant enough.

Result Card must answer:
- what happened;
- why it happened;
- what changed.

It must not ask a new unresolved game choice unless the server also exposes a pending decision; in that case the Decision Layer follows or the experience becomes a Flow.

## 6. Decision Layer

Decision Layer exists only for authoritative unresolved choices.

It must be derivable from projected server state.

Canonical structure:
- “Your decision is required” or mechanic-specific equivalent;
- context/title;
- concise reason;
- options;
- consequence hints where safe and helpful;
- no unrelated action controls.

Current families include:
- pendingEvent;
- pendingFeud;
- pendingAssignmentChoice;
- pendingIslandCorrection;
- pendingFleetAdjustment;
- pendingLegendaryReaction;
- alliance response;
- battle invite;
- treasure/cargo choice represented by pending event state;
- future pending families.

Decision Layer behavior:
- cannot be dismissed to bypass the choice;
- background map can remain visible;
- object sheets close or become inert;
- menu may remain accessible only for non-gameplay functions if it does not undermine the blocking state;
- the decision command comes from the existing canonical socket command.

For non-actor viewers:
- show generic waiting state, not private choice content.

## 7. Flow

Flow is used when one player experience spans multiple authoritative states.

Examples:
- sea battle;
- island assault;
- anchor encounter;
- event with target selection and result;
- alliance proposal;
- end-game consensus;
- expedition completion that leads into treasure hold choice;
- legendary reaction sequence.

A Flow may contain:
- introduction;
- target selection;
- confirmation;
- waiting for another player;
- Decision Layer;
- authoritative resolution;
- Result Card.

A Flow is not stored as an independent rules state if the backend does not already have such a state.

The frontend reconstructs the current step from:
- room phase;
- pending state;
- battle/alliance envelope;
- current viewer role;
- current projected outcome data;
- limited local navigation state.

## 8. Result queue

Result Cards are serialized.

At most one blocking Result Card is visible at a time.

Queue rules:
- FIFO within equal priority;
- mechanic-critical results before cosmetic achievements;
- a newly arriving Decision Layer interrupts Result Card display;
- interrupted Result Card returns to the head of the result queue unless it has become obsolete;
- final results discard ordinary queued Result Cards.

The queue must have a bounded retention policy so reconnect or bursty state changes cannot create dozens of stale cards.

Initial implementation target:
- keep only meaningful current-session results;
- collapse repeated trivial results into Toasts or one summary;
- cap blocking result backlog.

Exact numeric cap can be chosen during implementation after scenario testing.

## 9. Toast queue

Toasts are non-blocking and bounded.

Rules:
- duplicate identical messages within a short interval may coalesce;
- show a small maximum number simultaneously;
- older low-value toasts may be dropped;
- never drop a mandatory decision or blocking result because of toast pressure;
- journal may retain broader history if public/authorized.

## 10. Conflict resolution examples

Case A:
Player opens own island sheet, then receives alliance proposal.
- Decision Layer takes foreground.
- island sheet is hidden/suspended.
- after decision, sheet may reopen only if still relevant and safe.

Case B:
Anchor battle resolves and immediately causes fleet adjustment.
- authoritative pendingFleetAdjustment wins foreground.
- battle Result Card is queued.
- player resolves fleet adjustment.
- then battle Result Card appears with final outcome.

Case C:
Event result appears, then event flow advances to another player's private pending decision.
- local player's Result Card may appear if it does not expose future private state;
- otherwise generic waiting state takes priority.

Case D:
End-game proposal arrives during own actions.
- consensus Decision Layer appears if viewer must vote;
- after vote, own underlying turn state returns unchanged.

Case E:
Game finalizes while a cosmetic result is queued.
- final results screen wins;
- obsolete result queue is cleared.

## 11. Reconnect behavior

Reconnect must distinguish authoritative and cosmetic state.

Always reconstructed from server:
- Decision Layer;
- battle waiting;
- alliance waiting;
- event phase;
- end-game consensus;
- finished state;
- Scout reveal state that canonically survives reconnect;
- current phase/action/navigation state.

Not necessarily reconstructed:
- a Toast that was already shown;
- a purely cosmetic Result Card whose outcome is fully reflected in current state and has no persistent server envelope.

This means some future Result Cards need a reliable authoritative outcome envelope if replay after reconnect is important.

UI-3 does not add such backend fields. It only identifies the requirement.

## 12. Idempotence and duplicate delivery

Socket reconnects and roomState emissions may repeat the same authoritative state.

Presentation must not repeatedly spawn the same blocking card.

Future event/result presentation entries should have stable identity when possible:
- pending id;
- battle id;
- consensus proposal identity;
- result sequence/id if later introduced.

Client may maintain a bounded “presented cosmetic IDs” set.

Do not use text content alone as the only identity for critical UX.

## 13. Acknowledgement semantics

“Continue” on a Result Card usually means:
- dismiss presentation;
- reveal the current already-authoritative game state.

It must not secretly perform gameplay unless explicitly labeled.

If acknowledgement itself is a canonical command, the UI is no longer a pure Result Card; it is a Decision/Flow step.

## 14. Timing and animation

Animations support comprehension but never own state.

Rules:
- short;
- skippable;
- reduced-motion compatible;
- no gameplay legality waits on animation completion;
- a higher-priority Decision Layer may cut an animation short;
- server state changes render immediately even if transition styling is still finishing.

## 15. Event presentation

Sailing events use the same system.

Automatic event:
- Event Card/Result Card;
- explain effect;
- Continue when significant.

Event with choice:
- Event intro;
- Decision Layer;
- Result Card if consequence is significant.

Event requiring map target:
- Event intro;
- targeting mode;
- authoritative command;
- Result Card.

Forced movement example:
- “Storm”
- “Your ship was carried to the coast of Renaika.”
- map recenters on new position after acknowledgement or during transition.

No technical deck/index language.

## 16. Anchor encounter presentation

Anchor encounter becomes a Flow:

1. anchor sheet: Enter encounter/battle;
2. command sent;
3. authoritative result received;
4. Result Card:
   - encounter name;
   - player power vs encounter power where rules expose it;
   - victory/defeat/draw;
   - reward/loss;
5. Continue returns to map/actions.

Current direct numeric mutation is not sufficient as final UX.

## 17. Sea battle presentation

Battle Flow:

1. target selected;
2. battle preview sheet;
3. declare attack;
4. optional legal reaction/invite steps;
5. waiting state;
6. authoritative resolution;
7. Result Card.

Result Card can show:
- sides;
- relevant known totals;
- outcome;
- rewards;
- losses;
- resulting major status changes.

Unknown/private values remain omitted.

## 18. Assault presentation

Assault Flow mirrors battle:

1. island selected;
2. assault preview;
3. declare;
4. ally/reaction decisions;
5. authoritative resolution;
6. if a new mandatory island-retention/correction decision exists, Decision Layer first;
7. Result Card after mandatory consequences are settled.

## 19. Assignment and expedition outcomes

Assignment issued:
- lightweight received-goal Result Card or Toast depending importance;
- persistent home becomes Goals.

Assignment completed:
- Result Card with reward.

Expedition accepted:
- Goals update;
- optional concise confirmation.

Expedition completed:
- Result Card;
- if treasure resolution requires a cargo choice, that Decision Layer takes priority;
- final reward card follows once authoritative choice resolves.

## 20. Island/economy outcomes

Routine:
- build/upgrade/load/sell may use Toast when the selected sheet already clearly shows the result.

Significant:
- settlement -> city;
- city -> major port;
- island captured;
- island lost;
- major unique building/reward;
- permanent garrison changes caused by major events;
may use Result Card.

Avoid interrupting the player for every construction click.

## 21. Politics/alliance outcomes

Alliance proposal:
- Decision Layer for recipient;
- waiting state for proposer;
- Toast/Result for accepted/rejected depending prominence.

Vassalage/rebellion:
- Result Card when the political status meaningfully changes.

Public political changes for other players:
- ambient Toast if policy allows;
- full details remain in Diplomacy/journal.

## 22. End-game UX

Proposal:
- global Decision Layer for players who must vote.

Already-confirmed/proposer:
- waiting/status presentation.

Accepted:
- compact Result/Status transition:
  “Unanimous. This is the last round.”
- HUD gains LAST ROUND state.

Finalization:
- dedicated final results screen, not a Result Card.

## 23. Waiting presentation

Waiting is not an error state.

Use a dedicated compact foreground/status treatment when backend is blocked by another actor.

Examples:
- “Waiting for Alex's decision.”
- “Waiting for battle invitations.”
- “Max is resolving an event.”

Do not expose:
- private pending kind when projection hides it;
- private option names;
- hidden card names.

Waiting UI may allow:
- map inspection;
- public object inspection if safe;
- Menu;
but no gameplay command that backend would reject due to the blocker.

## 24. Error presentation

Command errors are separate from game outcomes.

Use:
- inline error near initiating control for local validation/server rejection;
- Toast for transient connection/retry messages;
- blocking technical error only when the game cannot continue.

Do not present a rejected socket command as a game Result Card.

## 25. Classification table

Default classification:

- roll result -> Action Bar state, not Result Card;
- routine movement -> map transition, not Result Card;
- routine cargo load -> Toast;
- routine sell -> Toast;
- build/upgrade -> Toast unless status milestone;
- character acquisition -> Toast/short Result;
- Scout reveal -> short Result + updated target sheet;
- Cartographer peek -> private result sheet/card;
- anchor outcome -> Result Card;
- sea battle -> Flow + Result Card;
- assault -> Flow + Result Card;
- sailing event -> Result Card or Flow;
- feud requiring choice -> Decision Layer;
- assignment choice -> Decision Layer;
- island correction -> Decision Layer;
- fleet adjustment -> Decision Layer;
- legendary reaction -> Decision Layer;
- alliance proposal -> Decision Layer;
- battle invite -> Decision Layer;
- assignment completion -> Result Card;
- expedition completion -> Result Card/Flow;
- island capture -> Result Card;
- vassalage/rebellion -> Result Card;
- end-game proposal -> Decision Layer;
- end-game accepted -> global status/result;
- finalization -> Final Results screen.

This is a default. Individual mechanics may be refined during their migration stage without breaking the four-class system.

## 26. Presentation data gap register

UI-3 identifies several outcomes that the current client may know only through:
- ack payload;
- last* fields;
- changed state;
- server log.

Before implementing robust Result Cards, each mechanic must be checked for a stable, viewer-safe result payload.

Likely candidates for explicit presentation envelopes:
- anchor encounter result;
- battle resolution result;
- assault resolution result;
- significant automatic event result;
- assignment completion;
- expedition completion;
- major island acquisition/status change.

Any new presentation envelope must:
- be viewer-projected;
- contain no hidden data;
- be idempotent;
- not become a second persistence authority;
- survive reconnect only when product UX requires replay.

This is implementation work for later stages, not UI-3.

## 27. Testing contract

Future tests must verify:

- Decision Layer always outranks Result Card;
- Result Card outranks voluntary sheet;
- private pending content is never shown to non-actor;
- duplicate roomState does not duplicate critical presentation;
- reconnect restores authoritative pending/waiting/final state;
- finished state clears obsolete UX queue;
- a queued Result Card resumes after a higher-priority decision;
- Toast overflow cannot hide critical surfaces;
- result acknowledgement does not accidentally issue gameplay commands.

## 28. UI-3 acceptance

UI-3 is complete when:

- the four presentation classes are canonical;
- priority order is fixed;
- queue/conflict rules are fixed;
- reconnect/idempotence behavior is fixed;
- event, anchor, battle, assault, assignment, expedition, politics and end-game examples are classified;
- the distinction between authoritative state and cosmetic presentation is explicit;
- known result-data gaps are documented without inventing new backend mechanics.

After UI-3, CHECKPOINT UX-A covers the specification, current frontend audit, state-to-UI contract and unified feedback architecture.
