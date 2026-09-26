# API and Architecture Audit - 2026-09-25

## Existing integration

Reviewed the installed rolfoundry manifest, roll-return extra, compatibility scripts, Foundry Rolls Bridge and the relevant installed Foundry 14 client source. The active manifest loads Foundry as its remote entryPoint. injection.js is not an active extra. Existing dice callbacks and the roll bridge were retained without code changes.

The scope of this audit is the linking integration and its dependencies, not a certification of every installed world module. Previous sheet changes completed elsewhere are outside this change.

## TaleSpire

Official sources: https://symbiote-docs.talespire.com/api_doc_v0_1.md.html and https://symbiote-docs.talespire.com/manifest_doc_v1.html

Validated documented calls: creatures.getSelectedCreatures, creatures.getMoreInfo, campaigns.whereAmI. Selection returns instance fragments. More-info supplies display information subject to API permissions. Manifest subscriptions used: creatures.onCreatureSelectionChange and onCreatureStateChange. Events trigger a fresh read; received event payloads are not trusted as commands.

No documented arbitrary-creature select/focus or HP-write call was found in that API. These operations are not invented or emulated through native mods. Capability detection reports unsupported operations explicitly.

## Foundry 14

Read installed public/scripts/foundry.mjs under the Foundry Virtual Tabletop resources/app directory; no edits made there.

Checked canvas.tokens.controlled, Scene TokenDocument.actor and synthetic actor resolution, fromUuid, setFlag/unsetFlag, world settings registration, game.users.activeGM, Scene.view, Token.control, canvas.animatePan, ApplicationV2, DialogV2, and document hooks. UI uses ApplicationV2; existing system/custom actor sheets retain their own render API. V2 sheets receive an options object, older native sheet implementations receive their existing render signature.

Combat.getCombatantsByToken is used instead of deprecated singular getCombatantByToken. Results are filtered by full token UUID so identical embedded IDs across scenes are not confused.

preCreateToken strips copied link flags. Recovery also checks stamped UUID, covering imported/copied flags that bypass this hook. Deletion or changed actor marks an association invalid rather than guessing another actor.

## Decisions and risks

- Separate companion to avoid modifying the functioning sheets or dice bridge.
- Same-page bridge matches the deployed Symbiote. No cross-origin messages or incoming network commands.
- Canonical world registry plus recoverable token flags; failures in secondary mirrors do not invalidate a successful registry save.
- Identity includes campaign and complete scene token UUID. Names are resolved for display, not persisted in the shared index.
- Writes are serialized in the active GM client and stale conflict confirmations rejected. Two simultaneous editing sessions for that same GM remain unsupported; this is not a distributed transaction system.
- Shared world settings reveal association identifiers to authenticated clients; they must not contain secrets. UI permission checks are not encryption.
- Existing server/browser compatibility remains an external prerequisite. This task introduces no new core patches.
- Native TaleSpire and real multiplayer execution are pending. Source/API validation and mocked tests do not prove an end-to-end live run.
