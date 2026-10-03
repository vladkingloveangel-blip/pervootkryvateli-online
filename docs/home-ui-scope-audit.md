# Home UI scope audit — step 1

Baseline: `9841720eb94a6790aa45e558074d7fde58c8c746`.

## Scope boundary

The non-party UI is now rooted at `#homeShell[data-ui-scope="home"]`. The active party remains the existing, separate `#game[data-ui-scope="game"]` subtree. Future Home redesign work must stay inside `#homeShell`; it must not move, restyle, or replace the contents of `#game`.

`setGameScreenActive(active)` is the existing party-surface switch and now delegates the DOM boundary state to `syncAppSurface(active)`. That helper only toggles body surface classes and `aria-hidden` on the two roots. Existing party menu cleanup and logout availability remain in `setGameScreenActive`.

## Current non-party DOM

- `#authPanel`: login/registration.
- `#accountBar`: account identity, My Games, Profile, Admin (role-gated), logout.
- `#profilePanel`: display-name and password changes.
- `#adminPanel`: admin room list/spectator entry; retained legacy utility, not part of the planned player Home redesign.
- `#entry`: current room entry surface.
- `#myGamesPanel` inside `#entry`: saved/active rooms.
- create/join controls: `#nameInput`, `#shipSelect`, `#createBtn`, `#codeInput`, `#joinBtn`.
- `#logoutBtn`: account logout; `syncLogoutAvailability()` hides it whenever party context exists.
- `#game`: active-party/lobby subtree and explicit redesign exclusion.

## Current transition map

1. Startup → `initAuth()`.
2. Accounts enabled, no valid token → `showAuth()` → Auth visible; Entry/Game hidden.
3. Successful login/register or valid stored token → `applyAccount()` → account bar + Entry; `loadMyGames()`; invite handling may immediately continue.
4. Accounts disabled → Entry directly.
5. Entry → Create: `createRoom` socket event → `acceptSession()`.
6. Entry → Join: `joinRoomByCode()` / `joinRoom` → `acceptSession()`.
7. Invite `?room=...` → `maybeJoinInvite()` → existing join flow; code handling is preserved.
8. My Games → `resumeRoom` → `acceptSession()`.
9. Stored last room → `maybeResumeLastRoom()` → `resumeRoom` → `acceptSession()`.
10. `acceptSession()` → Home hidden semantically, `#entry` hidden, existing `#game` shown, party URL receives room code.
11. Party → Home/My Games → existing `goHome` acknowledgement → `clearSession()` → Game hidden, Entry shown, My Games refreshed, room query removed.
12. Profile → `openProfile()`; return via `closeProfile()` to admin, existing party, or Entry according to saved context.
13. Logout → clears account/session state, reconnects socket, hides party/admin/account surfaces, returns to Auth.
14. Admin/spectator transitions remain legacy behavior and are not redesigned by this Home plan.

## Dependencies and invariants

Home and party still share `public/app.js` and `public/styles.css`, so isolation is structural rather than a module split. The hard boundary is the root subtree: future Home CSS should be scoped through `#homeShell` / Home-specific classes, while party selectors remain untouched.

Do not change in Home steps: `#game` descendants, game HUD, map, action bar, island cards, combat/event layers, gameplay bottom sheets, in-game menu, gameplay socket/API contracts, or server-side rules.

Existing account, create/join, invite, My Games, `resumeRoom`, profile, `goHome`, and logout behavior are compatibility requirements for subsequent steps.
