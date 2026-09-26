import { check, keyOf } from "./model.js";

// Encounters group linked minis into the zones of an adventure (A1, A2, ...),
// so the panel lists one room instead of the whole dungeon and a room can be
// started as a Foundry combat. Stored beside the links, never inside them:
// the link registry and its recovery rules stay exactly as they were.
//
// Membership is by TaleSpire mini (campaign + creature key), not by token, so
// relinking a mini to another token keeps it in its room. A mini belongs to at
// most one encounter — zones do not overlap.

export const ENCOUNTER_SCHEMA = 1;
const MAX_NAME = 40;

export function emptyEncounters() { return { version: ENCOUNTER_SCHEMA, revision: 0, encounters: {} }; }

export function validateEncounters(registry) {
  check(registry?.version === ENCOUNTER_SCHEMA && registry.encounters && typeof registry.encounters === "object", "versionMismatch");
  const seen = new Set();
  for (const [id, encounter] of Object.entries(registry.encounters)) {
    check(encounter?.id === id && typeof encounter.name === "string" && Array.isArray(encounter.members), "invalidResponse");
    for (const key of encounter.members) {
      const [campaign, creature] = String(key).split(":");
      check(keyOf(campaign, creature) === key && !seen.has(key), "conflict");
      seen.add(key);
    }
  }
  return registry;
}

export function cleanName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  check(name.length > 0, "encounterName");
  return name;
}

function nameTaken(registry, name, exceptId = null) {
  const wanted = name.toLocaleLowerCase();
  return Object.values(registry.encounters).some(e => e.id !== exceptId && e.name.toLocaleLowerCase() === wanted);
}

function bump(registry) { registry.revision++; return registry; }

export function createEncounter(registry, rawName, id) {
  validateEncounters(registry);
  const name = cleanName(rawName);
  check(!nameTaken(registry, name), "encounterExists");
  check(typeof id === "string" && id.length > 0 && !registry.encounters[id], "invalidResponse");
  const next = structuredClone(registry);
  next.encounters[id] = { id, name, members: [], createdAt: Date.now() };
  return { next: bump(next), id };
}

export function renameEncounter(registry, id, rawName) {
  validateEncounters(registry);
  check(registry.encounters[id], "changed");
  const name = cleanName(rawName);
  check(!nameTaken(registry, name, id), "encounterExists");
  const next = structuredClone(registry);
  next.encounters[id].name = name;
  return bump(next);
}

// Deleting a zone only forgets the grouping: its minis stay linked, unassigned.
export function deleteEncounter(registry, id) {
  validateEncounters(registry);
  check(registry.encounters[id], "changed");
  const next = structuredClone(registry);
  delete next.encounters[id];
  return bump(next);
}

// Moves minis into `id`, taking them out of whichever zone held them. A null
// id unassigns them.
export function assignMinis(registry, id, keys) {
  validateEncounters(registry);
  check(id === null || registry.encounters[id], "changed");
  const moving = new Set(keys);
  const next = structuredClone(registry);
  for (const encounter of Object.values(next.encounters)) {
    encounter.members = encounter.members.filter(key => !moving.has(key));
  }
  if (id !== null) next.encounters[id].members.push(...moving);
  return bump(next);
}

export function encounterOf(registry, key) {
  return Object.values(registry.encounters).find(e => e.members.includes(key))?.id ?? null;
}

// A1, A2, ..., A10 — numbers compare as numbers.
export function sortedEncounters(registry) {
  return Object.values(registry.encounters)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }));
}

// The name the "new encounter" prompt offers: the last zone's number plus one
// (A3 -> A4, "Sala 9" -> "Sala 10"), so a dungeon is typed once per room.
export function suggestName(registry) {
  const last = sortedEncounters(registry).at(-1)?.name;
  const match = last?.match(/^(.*?)(\d+)$/);
  return match ? `${match[1]}${Number(match[2]) + 1}` : "";
}
