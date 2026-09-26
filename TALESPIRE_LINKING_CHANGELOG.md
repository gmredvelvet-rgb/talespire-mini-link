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
