# Verification

Automated on 2026-09-25: 15 tests passed, zero failures, using Node's test runner. These are unit and mocked-adapter integration tests, NOT live Foundry/TaleSpire acceptance tests. Recovery also requires approval of the exact current candidate set.

Covered: one/zero/multiple selection; five duplicate names; serialized registry reload; conflict replacement; stale confirmation rejection; unlink tombstones; duplicated token/scene stamps; ambiguous recovery; timeout; LinkManager persistence/recreation; GM/player authorization; deleted token; changed actor; synthetic actor identity; malformed reply correlation/version; actual installed Symbiote extra with mocked TS API; preservation of dice callback reference.

Run in the module directory with PowerShell:

```powershell
$env:TML_SYMBIOTE_PATH = "$env:USERPROFILE\AppData\LocalLow\BouncyRock Entertainment\TaleSpire\Symbiotes\rolfoundry\talespire-mini-link.js"
node --test tests/*.test.mjs
```

Without TML_SYMBIOTE_PATH, the native-extra integration test is explicitly skipped; all other tests remain portable.

## Pending live acceptance

Use a backed-up/test world and disposable tokens. None of these live steps has been marked passed:

1. Activate companion and reopen Symbiote; check panel at narrow and wide widths.
2. Select one token in the embedded Foundry client and one TaleSpire mini; link and open its configured sheet.
3. Try zero/two minis and zero/two tokens; confirm rejected without data changes.
4. Link five identically named creatures to five separate tokens; verify distinct IDs.
5. Refresh Foundry, reopen TaleSpire, restart server; verify stored links.
6. Change scenes and use Select Token; verify exact scene and token.
7. Delete linked token; verify broken status. Duplicate linked token and whole scene; ensure originals remain authoritative.
8. Test unlinked synthetic tokens with different state from one base actor, and linked world actors, under PF2e and D&D.
9. Confirm unlink deletes no game entity and recovery does not restore a retired link.
10. Login as a player; verify edit denial, hidden-token filtering, allowed sheet access and ownership checks.
11. Toggle automatic selection/focus; test rapidly switching mini selections.
12. Stop server while connected, then restart; observe disconnected state or reload requirement.
13. Regression-test existing dice forwarding/return, VN interface and sheets. Their code was not modified, but live coexistence still needs testing.

Known coverage gaps: native Symbiote event delivery, live persistence/restart, actual server permission enforcement, pixel-level panel layout and simultaneous multiplayer sessions.
