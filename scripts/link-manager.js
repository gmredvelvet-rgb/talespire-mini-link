import { SCHEMA, keyOf, check, creatureId, indexes, conflicts, fingerprint, putLink, removeLink, recoverLinks } from "./model.js";

export class LinkManager {
  constructor(storage, foundryAdapter) {
    this.storage = storage;
    this.foundry = foundryAdapter;
    this.queue = Promise.resolve();
    this.refresh();
  }
  refresh() {
    this.registry = this.storage.read();
    Object.assign(this, indexes(this.registry));
  }
  serialize(work) {
    const result = this.queue.then(() => { this.storage.assertWriter(); this.refresh(); return work(); });
    this.queue = result.catch(() => {});
    return result;
  }
  preview(mini, token) {
    this.refresh();
    const key = keyOf(mini.campaignId, mini.id);
    const records = conflicts(this.registry, key, token.uuid);
    return { key, records, expected: fingerprint(records), tokenUuid: token.uuid, mini };
  }
  link(preview) {
    return this.serialize(async () => {
      const token = await this.foundry.getTokenByUuid(preview.tokenUuid);
      check(this.foundry.getSelectedToken().uuid === token.uuid, "changed");
      const normalized = this.foundry.normalize(token);
      check(normalized.actorUuid, "missingActor");
      const record = {
        version: SCHEMA, linkId: crypto.randomUUID(), creatureId: creatureId(preview.mini.id),
        campaignId: creatureId(preview.mini.campaignId), boardId: preview.mini.boardId,
        tokenUuid: normalized.uuid, actorUuid: normalized.actorUuid,
        syntheticActor: normalized.syntheticActor, linkedAt: Date.now(), linkedBy: game.user.id
      };
      this.refresh();
      const { next, previous } = putLink(this.registry, record, preview.expected);
      await this.storage.write(next);
      const mirrorWarning = await this.storage.mirror(record, previous);
      this.refresh();
      return { record, mirrorWarning };
    });
  }
  unlink(record) {
    return this.serialize(async () => {
      const { next } = removeLink(this.registry, keyOf(record.campaignId, record.creatureId), record.linkId);
      await this.storage.write(next);
      const mirrorWarning = await this.storage.mirror(null, [record]);
      this.refresh();
      return { mirrorWarning };
    });
  }
  previewRecovery() {
    this.storage.assertWriter();
    this.refresh();
    return recoverLinks(this.registry, this.storage.mirrors());
  }
  rebuild(expected) {
    return this.serialize(async () => {
      const result = recoverLinks(this.registry, this.storage.mirrors());
      check(fingerprint(Object.values(result.next.links)) === expected, "changed");
      if (result.recovered) await this.storage.write(result.next);
      this.refresh();
      return result;
    });
  }
  async resolve(record) {
    const token = await this.foundry.getTokenByUuid(record.tokenUuid);
    const normalized = this.foundry.normalize(token);
    check(normalized.actorUuid, "missingActor");
    // A replaced actor requires explicit re-link; never fall back to a world actor.
    check(normalized.actorUuid === record.actorUuid && normalized.syntheticActor === record.syntheticActor, "changedActor");
    return { record, token: normalized };
  }
  async visibleLinks() {
    this.refresh();
    const links = [];
    for (const record of this.byCreatureId.values()) {
      try { links.push({ ...(await this.resolve(record)), status: "linked" }); }
      catch (error) {
        if (game.user.isGM) links.push({ record, status: error.code ?? "unavailable" });
      }
    }
    return links;
  }
}
