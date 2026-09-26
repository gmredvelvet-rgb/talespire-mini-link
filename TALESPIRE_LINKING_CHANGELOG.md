# 1.5.0 - Encounters by room

Encounters group linked minis into the rooms of an adventure (A1, A2, ...). Stored in their own world setting (encounters), beside the link registry, which is unchanged. Membership is by TaleSpire mini, so relinking a mini to another token keeps its room; a mini belongs to one room at most.

- Panel: an encounter filter (all minis, no encounter, or one room) with counts. As the active GM: New encounter (suggests the next number, A3 -> A4), Add selection (the linked minis selected in TaleSpire), Rename, Delete (its minis stay linked) and a per-link selector to move a mini between rooms.
- Start encounter: creates the Foundry combat with the room's tokens on the scene being viewed plus the party's tokens, ending the combat running on that scene after confirmation. Combatants are created inside the Combat in one operation, so only createCombat fires and VN Enhanced fills its cast once instead of racing a save per createCombatant. Hidden tokens join hidden. Minis on another scene are reported, not added.
- VN Enhanced: the previous room's enemies leave its NPC panel through its public API (removeActor) before the combat is created, since VN adds its whole cast to the combat when combat mode starts; the party side is never touched. VN enters combat mode only if it is open or already fighting.
- Links are titled by their Foundry token instead of the TaleSpire creature GUID, and row actions are icons (with tooltips), so a room reads at a glance.
- The panel keeps an open dropdown open: the 5 s refresh waits while a select has focus.
- API: startEncounter(nameOrId) for macros.
- Copy a token's name in two clicks, to paste it as its TaleSpire mini's name: right-click the token and press the copy button on its HUD, or use the copy button beside the selected token and on each link in the panel. Uses game.clipboard, which falls back to execCommand when the embedded browser refuses the async clipboard.
- Panel redesign: connection chips and an icon refresh in the header; the current selection as a card whose main step is a gold primary button; zone rename and delete beside the filter; Start encounter as the primary action of a room; links as cards with square icon actions and unlink set apart in red; problems (missing token, changed actor) flagged on the card instead of a status line on every link. One button vocabulary (primary, secondary, danger, ghost, icon) with hover, focus and disabled states, and Foundry tooltips instead of native titles.

Tests: 4 new (zone rules, numeric sorting and name suggestion, starting an encounter end to end with Foundry and VN stubbed, the HUD copy button).

# 1.4.0 - Select a mini, target its token

New client setting Target Linked Minis on Selection (autoTarget, on by default). Selecting linked TaleSpire minis that are not the user's own makes them that user's Foundry targets (canvas.tokens.setTargets, mode replace) — the same targets VN Enhanced's Select as target sets, so its plates, VS duel and HUD follow through its targetToken hook with no VN change. Several selected minis give several targets; clearing the TaleSpire selection keeps the targets; the user's own mini is never targeted.

Own side: a player's owned tokens; for the GM, tokens no player owns (NPCs).

Targeting no longer depends on reading the actor: players rarely hold OBSERVER on an enemy, which made 1.3 auto selection fail silently on every enemy. The link is checked against the placed token instead — current scene, not GM-hidden for players, same actor id and linked/synthetic mode as when it was linked.

Auto Select Linked Token now controls only the user's own linked mini while targeting is on, so picking an enemy never swaps the attacker. With targeting off it keeps its 1.3 behaviour. Selection bursts are queued instead of dropped.

The panel opens from a chain button tool in the Token controls column instead of a floating button laid over the scene controls. Disabling the module removes the tool without a reload.

Licence: the family soft gate (scripts/license). Velvet License Hub is required, as for the rest of the family; with it active this module registers with the hub and never contacts the server or shows its own card. Nothing is ever blocked.

Published as its own repository, gmredvelvet-rgb/talespire-mini-link, with manifest and download URLs for in-app updates.

Tests: 7 new (selection plan, targeting identity checks, synthetic actors, own side for players and GM, no rebroadcast of unchanged targets, SceneControls rules for the tool, hub registration). Symbiote files unchanged.

# 1.3.0 - Initial Mini Linking Companion

New module files: module.json, package.json, scripts/model.js, scripts/adapters.js, scripts/link-manager.js, scripts/main.js, styles/linking.css, lang/en.json, lang/es.json, tests/linking.test.mjs, README.md and docs/*.

Existing Symbiote: modified manifest.json (version 1.3.0, creatures subscriptions and mini-link extra). Added talespire-mini-link.js. EntryPoint, dice callbacks, state callback, logo and existing roll extra retained.

Added: persistent one-to-one links, conflict confirmation, unlink, recovery, exact Token/Actor resolution, synthetic actor handling, owned token selection, configured sheet opening, optional automatic selection and debug/combat information.

Prevented during implementation: identity collisions from duplicate names, copied token flags taking over a link, deleted associations returning through stale flags, stale confirmations replacing newer links, fallback to an unrelated world actor, and hidden names being stored in the shared registry.

No changes to Foundry core, character sheets, VN Enhanced, Foundry Rolls Bridge or existing compatibility scripts. No world actor, token, ownership, HP or combat data was changed during development. Once used, the companion writes its own world setting and token flag only.

Limits: same embedded client selection; a single active-GM editing session; no programmatic TaleSpire mini selection/focus; no HP or targeting sync. Live acceptance remains pending.
