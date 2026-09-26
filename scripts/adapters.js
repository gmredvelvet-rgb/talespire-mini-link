import { ID, VERSION, PROTOCOL, SCHEMA, TYPES, check, one, tokenUuid, timeout } from "./model.js";

export class TaleSpireAdapter {
  async request(type, payload = {}) {
    const bridge = globalThis.TML_SYMBIOTE;
    check(typeof bridge?.request === "function", "disconnected");
    const requestId = foundry.utils.randomID();
    const reply = await timeout(bridge.request({ protocol: PROTOCOL, version: SCHEMA, requestId, type, payload }));
    check(reply?.protocol === PROTOCOL && reply.version === SCHEMA, "versionMismatch");
    check(reply.requestId === requestId && reply.type === type, "invalidResponse");
    check(reply.ok, reply.error ?? "invalidResponse");
    return reply.payload;
  }
  hello() { return this.request(TYPES.HELLO, { moduleVersion: VERSION }); }
  getSelectedCreatures() { return this.request(TYPES.SELECTION); }
  getCreatureInfo(id) { return this.request(TYPES.INFO, { id }); }
  selectCreature() { return { supported: false }; }
  focusCreature() { return { supported: false }; }
}

export class FoundryAdapter {
  getSelectedTokens() {
    return (globalThis.canvas?.tokens?.controlled ?? []).map(t => t.document).filter(t => t.parent?.documentName === "Scene");
  }
  getSelectedToken() { return one(this.getSelectedTokens(), "noToken", "manyTokens"); }
  async getTokenByUuid(uuid) {
    tokenUuid(uuid);
    const doc = await fromUuid(uuid);
    check(doc?.documentName === "Token" && doc.parent?.documentName === "Scene", "missingToken");
    return doc;
  }
  getActorFromToken(token) { return token.actor; }
  canRead(token) {
    return game.user.isGM || (!token.hidden && !!token.actor?.testUserPermission(game.user, "OBSERVER"));
  }
  requireRead(token) { check(this.canRead(token), "permission"); }
  normalize(token) {
    this.requireRead(token);
    const actor = this.getActorFromToken(token);
    return {
      uuid: token.uuid, id: token.id, name: token.name, sceneUuid: token.parent.uuid,
      actorUuid: actor?.uuid ?? null, actorName: actor?.name ?? null,
      syntheticActor: !!actor?.isToken, actorLink: token.actorLink
    };
  }
  async selectToken(uuid, { focus = false, switchScene = false } = {}) {
    const token = await this.getTokenByUuid(uuid);
    this.requireRead(token);
    check(token.isOwner, "permission");
    check(!game.settings.get("core", "noCanvas"), "noCanvas");
    if (globalThis.canvas?.scene?.id !== token.parent.id) {
      check(switchScene, "otherScene");
      check(game.user.isGM || token.parent.isOwner || token.parent.active || token.parent.navigation, "permission");
      await token.parent.view();
    }
    const object = token.object;
    check(canvas.ready && object && canvas.scene?.id === token.parent.id, "noCanvas");
    check(object.control({ releaseOthers: true }), "permission");
    if (focus) await canvas.animatePan({ x: object.center.x, y: object.center.y });
    return this.normalize(token);
  }
  // Targeting asks far less than control: Foundry lets any user target a token
  // they can see, owner or not, and a player can rarely read the actor behind an
  // enemy. So the link is checked against the placed token itself — current
  // scene, not GM-hidden, same actor id and link mode as when it was linked —
  // and never through normalize(), which requires OBSERVER on the actor.
  targetableToken(record) {
    const [, sceneId, , tokenId] = tokenUuid(record.tokenUuid).split(".");
    check(!game.settings.get("core", "noCanvas") && globalThis.canvas?.ready, "noCanvas");
    check(canvas.scene?.id === sceneId, "otherScene");
    const object = canvas.tokens.get(tokenId);
    check(object, "missingToken");
    const doc = object.document;
    check(game.user.isGM || !doc.hidden, "permission");
    check(record.syntheticActor === !doc.actorLink && record.actorUuid.endsWith(`Actor.${doc.actorId}`), "changedActor");
    return object;
  }
  // "Own" is the side this user plays. A player owns their character; the GM owns
  // everything, so for the GM it is the tokens no player owns — the NPCs.
  isOwnToken(object) {
    return game.user.isGM ? !object.actor?.hasPlayerOwner : object.document.isOwner;
  }
  // Replaces this user's targets. Skipped when nothing would change, so repeated
  // TaleSpire selection events do not rebroadcast the same targets.
  setTargets(objects) {
    const ids = objects.map(o => o.id);
    const current = new Set([...(game.user.targets ?? [])].map(t => t.id));
    if (ids.length === current.size && ids.every(id => current.has(id))) return false;
    canvas.tokens.setTargets(ids, { mode: "replace" });
    return true;
  }
  getCurrentCombatant() {
    const combatant = game.combat?.combatant;
    const token = combatant?.token;
    if (!token || !this.canRead(token) || (!game.user.isGM && combatant.hidden)) return null;
    return { uuid: combatant.uuid, tokenUuid: token.uuid, round: game.combat.round, turn: game.combat.turn };
  }
  getCombatants(token) {
    return (game.combat?.getCombatantsByToken(token) ?? [])
      .filter(c => c.token?.uuid === token.uuid && (game.user.isGM || !c.hidden));
  }
}

export class StorageService {
  read() { return structuredClone(game.settings.get(ID, "links")); }
  async write(registry) { await game.settings.set(ID, "links", registry); }
  assertWriter() {
    check(game.user.isGM, "gmOnly");
    check(game.users.activeGM?.id === game.user.id, "activeGMOnly");
  }
  async mirror(record, previous = []) {
    let failed = false;
    for (const old of previous) {
      try {
        const token = await fromUuid(old.tokenUuid);
        if (token?.getFlag(ID, "link")?.linkId === old.linkId) await token.unsetFlag(ID, "link");
      } catch { failed = true; }
    }
    if (record) {
      try {
        const token = await fromUuid(record.tokenUuid);
        if (token) await token.setFlag(ID, "link", record);
        else failed = true;
      } catch { failed = true; }
    }
    return failed;
  }
  mirrors() {
    return game.scenes.contents.flatMap(scene => scene.tokens.contents.map(token => ({ uuid: token.uuid, record: token.getFlag(ID, "link") }))).filter(x => x.record);
  }
}
