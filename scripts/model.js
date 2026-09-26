export const ID = "talespire-mini-link";
export const VERSION = "1.4.0";
export const PROTOCOL = "talespire-foundry-links";
export const SCHEMA = 1;
export const TYPES = Object.freeze({
  HELLO: "HELLO", PING: "PING", SELECTION: "GET_SELECTED_CREATURES", INFO: "GET_CREATURE_INFO"
});
export class LinkError extends Error {
  constructor(code) { super(code); this.code = code; }
}
export function check(condition, code) { if (!condition) throw new LinkError(code); }
export function creatureId(value) {
  check(typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value), "invalidId");
  return value.toLowerCase();
}
export function tokenUuid(value) {
  check(typeof value === "string" && /^Scene\.[A-Za-z0-9]{16}\.Token\.[A-Za-z0-9]{16}$/.test(value), "invalidUuid");
  return value;
}
export function keyOf(campaign, creature) { return `${creatureId(campaign)}:${creatureId(creature)}`; }
export function one(values, empty, multiple) {
  check(Array.isArray(values), "invalidResponse");
  check(values.length > 0, empty);
  check(values.length === 1, multiple);
  return values[0];
}
export function emptyRegistry() { return { version: SCHEMA, revision: 0, links: {}, retired: [] }; }
export function validateRecord(record) {
  check(record && record.version === SCHEMA, "versionMismatch");
  keyOf(record.campaignId, record.creatureId);
  tokenUuid(record.tokenUuid);
  check(typeof record.linkId === "string" && record.linkId.length > 0 && record.linkId.length < 100, "invalidResponse");
  return record;
}
export function indexes(registry) {
  check(registry?.version === SCHEMA && registry.links && Array.isArray(registry.retired), "versionMismatch");
  const byCreatureId = new Map(), byTokenUuid = new Map();
  for (const [key, record] of Object.entries(registry.links)) {
    validateRecord(record);
    check(key === keyOf(record.campaignId, record.creatureId), "invalidResponse");
    check(!byTokenUuid.has(record.tokenUuid), "conflict");
    byCreatureId.set(key, record);
    byTokenUuid.set(record.tokenUuid, record);
  }
  return { byCreatureId, byTokenUuid };
}
export function conflicts(registry, key, uuid) {
  const index = indexes(registry);
  return [...new Set([index.byCreatureId.get(key), index.byTokenUuid.get(uuid)].filter(Boolean))];
}
export function fingerprint(records) {
  return JSON.stringify(records.map(r => [r.linkId, r.tokenUuid, keyOf(r.campaignId, r.creatureId)]).sort());
}
export function putLink(registry, record, expected) {
  validateRecord(record);
  const key = keyOf(record.campaignId, record.creatureId);
  const previous = conflicts(registry, key, record.tokenUuid);
  check(fingerprint(previous) === expected, "changed");
  const next = structuredClone(registry);
  for (const old of previous) {
    delete next.links[keyOf(old.campaignId, old.creatureId)];
    if (!next.retired.includes(old.linkId)) next.retired.push(old.linkId);
  }
  next.links[key] = record;
  next.revision++;
  return { next, previous };
}
export function removeLink(registry, key, expectedId) {
  indexes(registry);
  const record = registry.links[key];
  check(record && record.linkId === expectedId, "changed");
  const next = structuredClone(registry);
  delete next.links[key];
  if (!next.retired.includes(record.linkId)) next.retired.push(record.linkId);
  next.revision++;
  return { next, record };
}
export function recoverLinks(registry, mirrors) {
  const next = structuredClone(registry);
  const index = indexes(next);
  let recovered = 0, skipped = 0;
  const candidates = new Map();
  for (const { uuid, record } of mirrors) {
    try {
      validateRecord(record);
      check(record.tokenUuid === uuid, "copiedToken");
      check(!next.retired.includes(record.linkId), "retired");
      const key = keyOf(record.campaignId, record.creatureId);
      if (!candidates.has(key)) candidates.set(key, []);
      candidates.get(key).push(record);
    } catch { skipped++; }
  }
  for (const [key, records] of candidates) {
    if (index.byCreatureId.has(key)) continue;
    if (records.length !== 1 || index.byTokenUuid.has(records[0].tokenUuid)) { skipped += records.length; continue; }
    const record = records[0];
    next.links[key] = record;
    index.byTokenUuid.set(record.tokenUuid, record);
    recovered++;
  }
  if (recovered) next.revision++;
  return { next, recovered, skipped };
}
// What a TaleSpire selection does in Foundry. `entries` are the linked minis in
// the selection, each tagged `own` when it is the user's side (see
// FoundryAdapter.isOwnToken). With targeting on, everyone else becomes the
// target set and only an own token is ever controlled — so picking an enemy
// never swaps the attacker. With targeting off, control keeps its 1.3 meaning:
// the one selected linked mini, whoever it is.
export function selectionPlan(entries, { autoTarget, autoSelect }) {
  const targets = autoTarget ? entries.filter(e => !e.own) : [];
  const candidates = autoTarget ? entries.filter(e => e.own) : entries;
  const control = autoSelect && candidates.length === 1 ? candidates[0] : null;
  return { targets, control };
}
export function timeout(promise, ms = 5000) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new LinkError("timeout")), ms);
  })]).finally(() => clearTimeout(timer));
}
