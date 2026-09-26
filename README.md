# TaleSpire Foundry Bridge - Mini Links 1.5.0

Companion for Foundry VTT 14 and the existing rolfoundry Symbiote. No native TaleSpire mods.

## Install

In Foundry, *Install Module* with this manifest URL:

    https://github.com/gmredvelvet-rgb/talespire-mini-link/releases/latest/download/module.json

It requires Velvet License Hub, which Foundry installs with it. Enable the module in the world, then reopen the updated Symbiote. Open the panel from the chain button in the Token controls, in the tool column of the left-hand menu.

## Link minis

As the designated active GM, select exactly one scene token in the Foundry client INSIDE the Symbiote, select exactly one TaleSpire mini, then click Link Selected Mini. A token selected in a separate desktop browser is not the selection of the embedded client. Each mini is linked once; links persist in the world.

To give a TaleSpire mini the same name as its Foundry token, right-click the token and press the copy button on its HUD (or the copy button in the panel), then paste the name in TaleSpire.

## Play

Select a linked enemy mini in TaleSpire and it becomes your target in Foundry, the same target VN Enhanced's Select as target sets. Then attack. Several selected minis give several targets; your own mini is never targeted. See the Target Linked Minis on Selection setting.

## Encounters

Group linked minis by room (A1, A2, ...) so the panel lists one room instead of the whole dungeon:

1. In the panel, *New encounter* and name it (the next number is suggested).
2. Select the room's minis in TaleSpire and press *Add selection*. Each link also has a selector to move it to another room.
3. Pick the room in the encounter filter to list only its minis.
4. *Start encounter* creates the Foundry combat with that room's tokens on the scene you are viewing plus the party's tokens. It ends the combat running on that scene (after asking) and replaces the enemies in VN Enhanced's NPC panel; the party side is untouched.

Macro: `game.modules.get("talespire-mini-link").api.startEncounter("A1")`.

## Licence

Free trial with every feature; a Patreon subscription removes the reminder. With Velvet License Hub active, one Patreon connection covers every module of the family. Nothing is ever blocked.

See docs/TALESPIRE_FOUNDRY_LINKING.md for instructions and limitations, docs/TALESPIRE_FOUNDRY_LINKING_AUDIT.md for API decisions, and docs/QA.md for verification status.

This is a companion, not a replacement for Foundry Rolls Bridge, compatibility patches, or character sheets. Existing components remain necessary for their respective functions.
