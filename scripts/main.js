import { ID, VERSION, SCHEMA, one, keyOf, check, emptyRegistry, fingerprint, selectionPlan } from "./model.js";
import { TaleSpireAdapter, FoundryAdapter, StorageService } from "./adapters.js";
import { LinkManager } from "./link-manager.js";
import { emptyEncounters, validateEncounters, createEncounter, renameEncounter, deleteEncounter, assignMinis, encounterOf, sortedEncounters, suggestName } from "./encounters.js";

const t = (key, data) => game.i18n.localize(`TML.${key}`, data);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let manager, panel, adapter, ts;
let refreshing = false, syncing = false, pendingRefresh = false, pendingSync = false;
const setting = key => game.settings.get(ID, key);
function errorText(error) {
  const code = error?.code ?? error?.message;
  const key = `TML.${code}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : t("unavailable");
}
function report(error) {
  if (setting("debug")) console.warn("[TaleSpireFoundry]", error);
  ui.notifications.warn(errorText(error));
}
// One button vocabulary for the whole panel. `variant` is any of: primary (the
// one main step of a card), danger, ghost (quiet, no surface), icon (square,
// its label becomes the tooltip) and block (full width); none is secondary.
function button(action, icon, label, { disabled = false, data = "", variant = "", text = null } = {}) {
  const tip = esc(t(label));
  const classes = ["tml-btn", ...variant.split(" ").filter(Boolean).map(v => `tml-btn-${v}`)].join(" ");
  const caption = variant.includes("icon") ? "" : `<span>${esc(text ?? t(label))}</span>`;
  return `<button type="button" class="${classes}" data-action="${action}" ${data} ${disabled ? "disabled" : ""} data-tooltip="${tip}" aria-label="${tip}"><i class="fa-solid ${icon}" inert></i>${caption}</button>`;
}

class MiniLinksPanel extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "talespire-mini-links", tag: "section", classes: ["tml-panel"],
    window: { title: "TML.title", resizable: true, icon: "fa-solid fa-link" },
    position: { width: 410, height: 630 },
    actions: {
      refresh: () => refreshPanel(),
      link: async function() { await this.perform(() => linkSelected()); },
      unlink: async function(event, target) { await this.perform(() => unlink(target.dataset.key)); },
      select: async function(event, target) { await this.perform(() => selectLinked(target.dataset.key)); },
      sheet: async function(event, target) { await this.perform(() => openSheet(target.dataset.key)); },
      inspect: async function(event, target) { await this.perform(() => inspectMini(target.dataset.key)); },
      rebuild: async function() { await this.perform(recoverWithConfirmation); },
      encNew: async function() { await this.perform(() => newEncounter()); },
      encRename: async function() { await this.perform(() => renameCurrentEncounter()); },
      encDelete: async function() { await this.perform(() => deleteCurrentEncounter()); },
      encAssign: async function() { await this.perform(() => assignSelection()); },
      encStart: async function() { await this.perform(() => startEncounter(this.filter)); },
      // Not through perform(): copying changes nothing, so there is nothing to refresh.
      copyName: (event, target) => copyName(target.dataset.copy).catch(report)
    }
  };
  // Encounters are read up front: the first render happens before the first
  // refresh, and must already know which zones exist.
  state = { connected: false, selection: [], tokens: [], links: [], failure: null, encounters: readEncounters() };
  busy = false;
  // "all", "none" (no encounter) or an encounter id. Per client, like a tab.
  filter = readFilter();
  setFilter(value) {
    this.filter = value;
    try { localStorage.setItem(FILTER_KEY, value); } catch { /* private mode */ }
  }
  async perform(work) {
    if (this.busy) return;
    this.busy = true;
    try { await work(); } catch (error) { report(error); }
    finally { this.busy = false; await refreshPanel(); }
  }
  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "tml-body";
    const { connected, selection, tokens, links, failure, hello, encounters } = this.state;
    const selected = selection.length === 1 ? selection[0] : null;
    const canWrite = game.user.isGM && game.users.activeGM?.id === game.user.id;
    const miniLabel = selected?.name ?? t(selection.length ? "manyMinis" : "noMini");
    const tokenLabel = tokens.length === 1 ? tokens[0].name : t(tokens.length ? "manyTokens" : "noToken");

    // Encounters: the filter decides which links are listed. A filter naming a
    // zone that no longer exists shows everything, without overwriting the
    // saved choice.
    const zones = sortedEncounters(encounters);
    const filter = ["all", "none"].includes(this.filter) || encounters.encounters[this.filter] ? this.filter : "all";
    const linkKey = ({ record }) => keyOf(record.campaignId, record.creatureId);
    const zoneOf = link => encounterOf(encounters, linkKey(link));
    const inFilter = link => filter === "all" || (filter === "none" ? !zoneOf(link) : zoneOf(link) === filter);
    const shown = links.filter(inFilter);
    const countIn = id => links.filter(l => zoneOf(l) === id).length;
    const zone = encounters.encounters[filter] ?? null;
    const selectedLinked = selection.filter(m => manager.byCreatureId.has(keyOf(m.campaignId, m.id))).length;
    const option = (value, label, current) => `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
    const filterSelect = `<select data-role="filter" aria-label="${esc(t("encounter"))}">
        ${option("all", `${t("encAll")} (${links.length})`, filter)}
        ${option("none", `${t("encNone")} (${links.filter(l => !zoneOf(l)).length})`, filter)}
        ${zones.length ? `<optgroup label="${esc(t("encounters"))}">${zones.map(z => option(z.id, `${z.name} (${countIn(z.id)})`, filter)).join("")}</optgroup>` : ""}
      </select>`;
    // Rename and delete act on the zone picked in the filter, so they sit beside it.
    const zoneEdit = canWrite && zone
      ? `${button("encRename", "fa-pen", "encRename", { variant: "icon ghost" })}${button("encDelete", "fa-trash", "encDelete", { variant: "icon ghost danger" })}`
      : "";
    const zoneTools = canWrite && zone ? `<div class="tml-enc-tools">
        ${button("encStart", "fa-swords", "encStart", { disabled: !countIn(zone.id), variant: "primary grow" })}
        ${button("encAssign", "fa-user-plus", "encAssignHint", { disabled: !connected || !selectedLinked, text: t("encAssign", { n: selectedLinked }) })}
      </div>` : "";
    const moveSelect = link => `<select class="tml-move" data-role="move" data-key="${esc(linkKey(link))}" aria-label="${esc(t("encMove"))}" data-tooltip="${esc(t("encMove"))}">
        ${option("", t("encNone"), zoneOf(link) ?? "")}${zones.map(z => option(z.id, z.name, zoneOf(link) ?? "")).join("")}
      </select>`;
    const zoneBadge = link => zoneOf(link) ? `<span class="tml-enc-badge">${esc(encounters.encounters[zoneOf(link)].name)}</span>` : "";
    const copy = (name, variant = "icon") => name ? button("copyName", "fa-copy", "copyName", { data: `data-copy="${esc(name)}"`, variant }) : "";
    const chip = (label, ok) => `<span class="tml-chip ${ok ? "is-ok" : "is-off"}" data-tooltip="${esc(t(ok ? "connected" : "disconnected"))}"><i class="fa-solid fa-circle" inert></i>${label}</span>`;
    const token = tokens.length === 1 ? tokens[0] : null;

    root.innerHTML = `
      <header class="tml-header">
        ${chip("TaleSpire", connected)}${chip("Foundry", !!game.socket?.connected)}
        <span class="tml-spacer"></span>
        ${button("refresh", "fa-rotate", "refresh", { variant: "icon ghost" })}
      </header>
      ${failure ? `<p class="tml-notice" role="status"><i class="fa-solid fa-triangle-exclamation" inert></i>${esc(failure)}</p>` : ""}
      <section class="tml-card">
        <div class="tml-field"><span class="tml-label">${esc(t("mini"))}</span><span class="tml-value ${selected ? "" : "is-empty"}">${esc(miniLabel)}</span></div>
        <div class="tml-field"><span class="tml-label">${esc(t("token"))}</span><span class="tml-value ${token ? "" : "is-empty"}">${esc(tokenLabel)}</span>${copy(token?.name, "icon ghost")}</div>
        ${game.user.isGM ? button("link", "fa-link", "link", { disabled: !canWrite || !connected || !selected || !token, variant: "primary block" }) : ""}
        ${game.user.isGM && !canWrite ? `<p class="tml-notice">${esc(t("activeGMOnly"))}</p>` : ""}
      </section>
      <section class="tml-card tml-encounters">
        <div class="tml-enc-bar">
          <label class="tml-select"><i class="fa-solid fa-dungeon" inert></i>${filterSelect}</label>
          ${zoneEdit}${canWrite ? button("encNew", "fa-plus", "encNew", { variant: "icon" }) : ""}
        </div>
        ${zoneTools}
      </section>
      <h3 class="tml-list-title">${esc(zone ? zone.name : t("savedLinks"))}<span class="tml-count">${shown.length}</span></h3>
      <div class="tml-links">${shown.map(link => {
        const { record, status, token: linked } = link;
        const key = linkKey(link);
        const current = selected && key === keyOf(selected.campaignId, selected.id);
        const data = `data-key="${esc(key)}"`;
        // Titled by the Foundry token: TaleSpire only names the selected mini, and
        // a list of creature GUIDs is unreadable once a dungeon is linked.
        const sub = [linked?.actorName ?? record.actorUuid, record.syntheticActor ? t("synthetic") : "", current && selected.name ? `${t("mini")}: ${selected.name}` : ""].filter(Boolean).join(" · ");
        return `<article class="tml-link ${current ? "tml-current" : ""} ${status === "linked" ? "" : "is-broken"}">
          <div class="tml-link-main">
            <div class="tml-link-text">
              <strong>${esc(linked?.name ?? record.creatureId)}</strong>
              <span class="tml-link-sub">${esc(sub)}</span>
              ${status === "linked" ? "" : `<span class="tml-warn"><i class="fa-solid fa-triangle-exclamation" inert></i>${esc(t(status))}</span>`}
            </div>
            ${canWrite ? moveSelect(link) : zoneBadge(link)}
          </div>
          <div class="tml-link-actions">
            ${button("select", "fa-crosshairs", "select", { disabled: status !== "linked", data, variant: "icon" })}
            ${copy(linked?.name)}
            ${button("sheet", "fa-address-card", "sheet", { disabled: status !== "linked", data, variant: "icon" })}
            ${button("inspect", "fa-circle-info", "inspect", { disabled: !connected || hello?.campaignId !== record.campaignId, data, variant: "icon" })}
            <span class="tml-spacer"></span>
            ${canWrite ? button("unlink", "fa-link-slash", "unlink", { data, variant: "icon ghost danger" }) : ""}
          </div>
          <details><summary>${esc(t("identifiers"))}</summary><dl><dt>Creature ID</dt><dd>${esc(record.creatureId)}</dd><dt>Token UUID</dt><dd>${esc(record.tokenUuid)}</dd><dt>Actor UUID</dt><dd>${esc(record.actorUuid)}</dd><dt>Campaign ID</dt><dd>${esc(record.campaignId)}</dd></dl></details>
        </article>`;
      }).join("") || `<p class="tml-empty">${esc(t(zone ? "encEmpty" : "empty"))}</p>`}</div>
      ${canWrite ? `<footer class="tml-footer">${button("rebuild", "fa-screwdriver-wrench", "rebuild", { variant: "ghost" })}</footer>` : ""}
      ${setting("debug") ? `<pre class="tml-debug">${esc(JSON.stringify({ protocol: SCHEMA, module: VERSION, symbiote: hello?.symbioteVersion, foundry: game.version, capabilities: hello?.capabilities, combat: adapter.getCurrentCombatant() }, null, 2))}</pre>` : ""}`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
  // Selects change state rather than click, so they are wired here, not in actions.
  _onRender(context, options) {
    super._onRender?.(context, options);
    // Each blurs first: refreshPanel waits while a select has focus.
    this.element.querySelector('[data-role="filter"]')?.addEventListener("change", event => {
      event.target.blur();
      this.setFilter(event.target.value);
      void this.render({ force: false });
    });
    for (const select of this.element.querySelectorAll('[data-role="move"]')) {
      select.addEventListener("change", () => {
        select.blur();
        void this.perform(() => moveMini(select.dataset.key, select.value || null));
      });
    }
  }
}

const FILTER_KEY = `${ID}:encounter-filter`;
function readFilter() {
  try { return localStorage.getItem(FILTER_KEY) || "all"; } catch { return "all"; }
}

async function snapshotTaleSpire() {
  const hello = await ts.hello();
  const selection = await ts.getSelectedCreatures();
  return { hello, selection };
}
async function refreshPanel() {
  if (!panel?.rendered || !setting("enabled")) return;
  if (refreshing || panel.busy) { pendingRefresh = true; return; }
  // Re-rendering replaces the markup, which would snap an open dropdown shut
  // under the user's cursor. The next heartbeat or change catches up.
  if (panel.element?.querySelector("select:focus")) return;
  refreshing = true;
  try {
    const state = { connected: false, selection: [], tokens: adapter.getSelectedTokens().filter(x => adapter.canRead(x)).map(x => adapter.normalize(x)), links: await manager.visibleLinks(), encounters: readEncounters() };
    try { Object.assign(state, await snapshotTaleSpire(), { connected: true }); }
    catch (error) { state.failure = errorText(error); }
    if (!game.socket?.connected) { state.connected = false; state.failure = t("foundryOffline"); }
    panel.state = state;
    if (panel.rendered) await panel.render({ force: false });
  } catch (error) { report(error); }
  finally {
    refreshing = false;
    if (pendingRefresh) { pendingRefresh = false; void refreshPanel(); }
  }
}
async function linkSelected() {
  check(setting("enabled") && game.socket?.connected, "foundryOffline");
  manager.storage.assertWriter();
  const mini = one(await ts.getSelectedCreatures(), "noMini", "manyMinis");
  const token = adapter.getSelectedToken();
  const preview = manager.preview(mini, token);
  if (preview.records.length) {
    const names = preview.records.map(r => `${esc(r.creatureId)} &rarr; ${esc(r.tokenUuid)}`).join("<br>");
    const accepted = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("replaceTitle") }, content: `<p>${esc(t("replacePrompt"))}</p><p>${names}</p>`,
      yes: { label: t("replace") }, no: { label: t("cancel") }, rejectClose: false
    });
    if (!accepted) return;
  }
  const current = one(await ts.getSelectedCreatures(), "noMini", "manyMinis");
  check(keyOf(current.campaignId, current.id) === preview.key, "changed");
  const result = await manager.link(preview);
  ui.notifications.info(t("linked"));
  if (result.mirrorWarning) ui.notifications.warn(t("mirrorWarning"));
}
function recordFor(key) { manager.refresh(); const record = manager.byCreatureId.get(key); check(record, "changed"); return record; }
async function unlink(key) {
  check(game.socket?.connected, "foundryOffline");
  manager.storage.assertWriter();
  const record = recordFor(key);
  const accepted = await foundry.applications.api.DialogV2.confirm({ window: { title: t("unlink") }, content: `<p>${esc(t("unlinkPrompt"))}</p><p>${esc(record.creatureId)} / ${esc(record.tokenUuid)}</p>`, rejectClose: false });
  if (!accepted) return;
  const result = await manager.unlink(record);
  if (result.mirrorWarning) ui.notifications.warn(t("mirrorWarning"));
}
async function selectLinked(key) {
  const record = recordFor(key);
  await manager.resolve(record);
  return adapter.selectToken(record.tokenUuid, { focus: true, switchScene: true });
}
async function recoverWithConfirmation() {
  check(setting("enabled") && game.socket?.connected, "foundryOffline");
  const preview = manager.previewRecovery();
  if (!preview.recovered) {
    ui.notifications.info(game.i18n.format("TML.rebuilt", preview));
    return;
  }
  const candidates = Object.entries(preview.next.links).filter(([key]) => !manager.registry.links[key]);
  const content = candidates.map(([, record]) => `<li>${esc(record.creatureId)} &rarr; ${esc(record.tokenUuid)}</li>`).join("");
  const accepted = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("rebuild") },
    content: `<p>${esc(t("recoverPrompt"))}</p><ul>${content}</ul>`,
    rejectClose: false
  });
  if (!accepted) return;
  const result = await manager.rebuild(fingerprint(Object.values(preview.next.links)));
  ui.notifications.info(game.i18n.format("TML.rebuilt", result));
}
// The token's own name (Identity tab), ready to paste as the name of its
// TaleSpire mini. game.clipboard falls back to execCommand when the embedded
// browser refuses the async clipboard.
async function copyName(name) {
  const text = String(name ?? "").trim();
  check(text, "missingToken");
  await game.clipboard.copyPlainText(text);
  ui.notifications.info(t("copied", { name: text }));
}

// ── Encounters ──────────────────────────────────────────────────────────────
// For display a damaged registry reads as empty; every write re-reads strictly,
// so a bad value is reported instead of silently overwritten.
function readEncounters() {
  try { return validateEncounters(structuredClone(game.settings.get(ID, "encounters"))); }
  catch (error) { if (setting("debug")) console.warn("[TaleSpireFoundry] Encounters unreadable", error); return emptyEncounters(); }
}
async function writeEncounters(change) {
  check(game.socket?.connected, "foundryOffline");
  manager.storage.assertWriter();
  const next = change(validateEncounters(structuredClone(game.settings.get(ID, "encounters"))));
  await game.settings.set(ID, "encounters", next);
}
async function promptName(title, value = "") {
  const name = await foundry.applications.api.DialogV2.prompt({
    window: { title },
    content: `<label class="tml-prompt">${esc(t("encName"))}<input type="text" name="name" maxlength="40" value="${esc(value)}" autofocus required></label>`,
    ok: { label: t("encSave"), callback: (event, target) => target.form.elements.name.value },
    rejectClose: false
  });
  return typeof name === "string" ? name : null;
}
function currentZone() {
  const zone = readEncounters().encounters[panel?.filter];
  check(zone, "changed");
  return zone;
}
async function newEncounter() {
  manager.storage.assertWriter();
  const name = await promptName(t("encNew"), suggestName(readEncounters()));
  if (name === null) return;
  const id = foundry.utils.randomID();
  await writeEncounters(registry => createEncounter(registry, name, id).next);
  panel.setFilter(id);
}
async function renameCurrentEncounter() {
  manager.storage.assertWriter();
  const zone = currentZone();
  const name = await promptName(t("encRename"), zone.name);
  if (name === null) return;
  await writeEncounters(registry => renameEncounter(registry, zone.id, name));
}
async function deleteCurrentEncounter() {
  manager.storage.assertWriter();
  const zone = currentZone();
  const accepted = await foundry.applications.api.DialogV2.confirm({
    window: { title: t("encDelete") }, content: `<p>${esc(t("encDeletePrompt", { name: zone.name }))}</p>`, rejectClose: false
  });
  if (!accepted) return;
  await writeEncounters(registry => deleteEncounter(registry, zone.id));
  panel.setFilter("all");
}
// The quick way to fill a room: select its minis in TaleSpire, press once.
async function assignSelection() {
  const zone = currentZone();
  manager.refresh();
  const keys = (await ts.getSelectedCreatures()).map(m => keyOf(m.campaignId, m.id)).filter(k => manager.byCreatureId.has(k));
  check(keys.length, "encNoSelection");
  await writeEncounters(registry => assignMinis(registry, zone.id, keys));
  ui.notifications.info(t("encAssigned", { n: keys.length, name: zone.name }));
}
async function moveMini(key, id) {
  await writeEncounters(registry => assignMinis(registry, id, [key]));
}

// Starts a room as the Foundry combat: its linked tokens on the scene being
// viewed, plus the party's tokens there. Everything that reads the combat —
// tracker, initiative, VN Enhanced — then shows that room and nothing else.
async function startEncounter(id) {
  check(game.socket?.connected, "foundryOffline");
  manager.storage.assertWriter();
  const zone = readEncounters().encounters[id];
  check(zone, "changed");
  const scene = globalThis.canvas?.ready ? canvas.scene : null;
  check(scene, "noCanvas");
  manager.refresh();
  const npcs = [], elsewhere = [];
  for (const key of zone.members) {
    const record = manager.byCreatureId.get(key);
    if (!record) continue;
    const [, sceneId, , tokenId] = record.tokenUuid.split(".");
    const token = sceneId === scene.id ? scene.tokens.get(tokenId) : null;
    if (token) npcs.push(token); else elsewhere.push(record);
  }
  check(npcs.length, "encounterEmpty");
  const party = scene.tokens.filter(token => token.actor?.hasPlayerOwner);
  const tokens = [...new Map([...party, ...npcs].map(token => [token.id, token])).values()];

  // Only the combat being run on this scene is replaced; other prepared
  // encounters are left alone.
  const current = game.combat?.scene?.id === scene.id ? game.combat : null;
  if (current) {
    const accepted = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("encStart") }, content: `<p>${esc(t("encReplacePrompt", { name: zone.name }))}</p>`, rejectClose: false
    });
    if (!accepted) return;
    await current.delete();
  }
  await vnReplaceNpcs(npcs.map(token => token.actorId));
  // One operation, combatants embedded: only createCombat fires, so VN fills
  // its cast once instead of racing one save per createCombatant.
  await Combat.implementation.create({
    scene: scene.id, active: true,
    combatants: tokens.map(token => ({ tokenId: token.id, sceneId: scene.id, actorId: token.actorId, hidden: token.hidden }))
  });
  await vnEnterCombat();
  ui.notifications.info(t("encStarted", { name: zone.name, npcs: npcs.length, pcs: party.length }));
  if (elsewhere.length) ui.notifications.warn(t("encElsewhere", { n: elsewhere.length, name: zone.name }));
}

// VN Enhanced builds its NPC panel from the combat but only ever adds to it, so
// the previous room's enemies go out through its public API first. The party
// (left side) is never touched.
function vnApi() {
  return game.modules.get("vnd-enhanced")?.active ? globalThis.VNEnhanced ?? null : null;
}
async function vnReplaceNpcs(keepActorIds) {
  const vn = vnApi();
  if (typeof vn?.getState !== "function" || typeof vn.removeActor !== "function") return;
  const keep = new Set(keepActorIds);
  for (const portrait of vn.getState().rightCast ?? []) {
    if (!keep.has(portrait.id)) await vn.removeActor(portrait.id);
  }
}
async function vnEnterCombat() {
  const vn = vnApi();
  if (typeof vn?.setCombatMode !== "function") return;
  const state = vn.getState();
  // Only a VN that is open or already fighting: starting a room must not open
  // the VN for a table that plays without it.
  if (state.showVN || state.combatMode) await vn.setCombatMode(true);
}

async function openSheet(key) {
  const record = recordFor(key);
  await manager.resolve(record);
  const token = await adapter.getTokenByUuid(record.tokenUuid);
  // Document sheet resolution handles both native system and custom sheets.
  const sheet = token.actor.sheet;
  sheet.render(sheet instanceof foundry.applications.api.ApplicationV2 ? { force: true } : true);
}
async function inspectMini(key) {
  const record = recordFor(key);
  await manager.resolve(record);
  const hello = await ts.hello();
  check(hello.campaignId === record.campaignId, "otherCampaign");
  const mini = await ts.getCreatureInfo(record.creatureId);
  await foundry.applications.api.DialogV2.wait({
    window: { title: t("mini") },
    content: `<p>${esc(mini.name)}</p><p>${esc(mini.id)}</p><p>${esc(t("selectionUnsupported"))}</p>`,
    buttons: [{ action: "close", label: t("close"), default: true }]
  });
}
// Mirrors the TaleSpire selection onto Foundry for this user: linked minis on
// the other side become this user's targets — exactly what "Select as target"
// does in VN Enhanced, which repaints from the same targetToken hook — and the
// user's own linked mini can be controlled as the attacker (autoSelect).
async function syncSelection() {
  const autoTarget = setting("autoTarget"), autoSelect = setting("autoSelect");
  if (!setting("enabled") || (!autoTarget && !autoSelect)) return;
  // Selection events arrive in bursts; the newest one must still be applied.
  if (syncing || panel?.busy) { pendingSync = true; return; }
  syncing = true;
  const skip = (what, error) => { if (setting("debug")) console.debug(`[TaleSpireFoundry] ${what} skipped`, error.code ?? error.message); };
  try {
    const selected = await ts.getSelectedCreatures();
    // Clicking the floor in TaleSpire clears its selection; the targets stay,
    // because the player is usually about to roll against them.
    if (!selected.length) return;
    manager.refresh();
    const entries = [];
    for (const mini of selected) {
      const record = manager.byCreatureId.get(keyOf(mini.campaignId, mini.id));
      if (!record) continue;
      try {
        const object = adapter.targetableToken(record);
        entries.push({ record, object, own: adapter.isOwnToken(object) });
      } catch (error) { skip("Linked mini", error); }
    }
    const { targets, control } = selectionPlan(entries, { autoTarget, autoSelect });
    if (targets.length) adapter.setTargets(targets.map(e => e.object));
    if (control && !adapter.getSelectedTokens().some(x => x.uuid === control.record.tokenUuid)) {
      try {
        await manager.resolve(control.record);
        await adapter.selectToken(control.record.tokenUuid, { focus: setting("autoFocus"), switchScene: false });
      } catch (error) { skip("Auto selection", error); }
    }
  } catch (error) { skip("Selection sync", error); }
  finally {
    syncing = false;
    if (pendingSync) { pendingSync = false; void syncSelection(); }
  }
}
async function openPanel() {
  check(setting("enabled"), "disabled");
  panel ??= new MiniLinksPanel();
  await panel.render({ force: true, position: { width: Math.min(410, window.innerWidth - 16), height: Math.min(630, window.innerHeight - 70), left: 8, top: 45 } });
  await refreshPanel();
}

Hooks.once("init", () => {
  game.settings.register(ID, "links", { scope: "world", config: false, type: Object, default: emptyRegistry() });
  game.settings.register(ID, "encounters", { scope: "world", config: false, type: Object, default: emptyEncounters() });
  // autoTarget is on by default: it is what lets a player attack by picking the
  // enemy mini in TaleSpire, and it only touches that player's own targets.
  for (const [key, scope, defaultValue] of [["enabled", "world", true], ["autoTarget", "client", true], ["autoSelect", "client", false], ["autoFocus", "client", false], ["debug", "client", false]]) {
    game.settings.register(ID, key, { name: `TML.${key}`, hint: `TML.${key}Hint`, scope, config: true, type: Boolean, default: defaultValue,
      onChange: () => {
        // Scene controls are prepared once; reset re-runs getSceneControlButtons.
        if (key === "enabled") ui.controls?.render({ reset: true });
        if (!setting("enabled")) panel?.close();
      } });
  }
});

// Two clicks from the map: right-click a token, press copy — no sheet, no token
// config. Same markup as the core HUD buttons; its own listener rather than a
// data-action, which the HUD would try to resolve as one of its actions.
Hooks.on("renderTokenHUD", (hud, html) => {
  if (Number(game.release.generation) !== 14 || !setting("enabled")) return;
  const column = html?.querySelector?.(".col.left");
  if (!column || column.querySelector(".tml-copy-name") || !hud.document?.name) return;
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "control-icon tml-copy-name";
  copy.dataset.tooltip = t("copyName");
  copy.setAttribute("aria-label", t("copyName"));
  copy.innerHTML = '<i class="fa-solid fa-copy" inert></i>';
  copy.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    copyName(hud.document?.name).catch(report);
  });
  column.append(copy);
});

// The panel opens from a button tool in the Token controls column, beside
// Foundry's own select, target and ruler tools. v14 only, and by v14's rules
// (see velvet-move's scene-controls check): onChange alone, because onClick
// fires as well; and a button never becomes the group's activeTool.
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens;
  if (Number(game.release.generation) !== 14 || !tokens?.tools || !setting("enabled")) return;
  tokens.tools.talespireMiniLinks = {
    name: "talespireMiniLinks",
    title: t("title"),
    icon: "fa-solid fa-link",
    button: true,
    order: Object.keys(tokens.tools).length + 1,
    onChange: () => openPanel().catch(report)
  };
});

Hooks.once("ready", () => {
  if (Number(game.release.generation) !== 14) return;
  ts = new TaleSpireAdapter(); adapter = new FoundryAdapter();
  manager = new LinkManager(new StorageService(), adapter);
  game.modules.get(ID).api = Object.freeze({ open: openPanel, version: VERSION, protocolVersion: SCHEMA,
    getSelectedToken: () => adapter.normalize(adapter.getSelectedToken()),
    getLink: async (campaignId, creatureId) => {
      manager.refresh(); const record = manager.byCreatureId.get(keyOf(campaignId, creatureId));
      return record ? manager.resolve(record) : null;
    },
    getCurrentCombatant: () => adapter.getCurrentCombatant(),
    rebuild: recoverWithConfirmation,
    // For macros: start a room by its name ("A1") or id, as the panel button does.
    startEncounter: nameOrId => {
      const zones = readEncounters().encounters;
      const zone = zones[nameOrId] ?? Object.values(zones).find(z => z.name.toLocaleLowerCase() === String(nameOrId).toLocaleLowerCase());
      check(zone, "changed");
      return startEncounter(zone.id);
    }
  });
  const invalidate = () => { if (panel?.rendered) void refreshPanel(); };
  window.addEventListener("tml:selection", () => { invalidate(); void syncSelection(); });
  window.addEventListener("frb:talespire-ready", invalidate);
  for (const name of ["controlToken", "canvasReady", "updateToken", "deleteToken", "deleteScene", "deleteActor", "updateActor", "updateCombat", "deleteCombat", "updateUser"]) Hooks.on(name, invalidate);
  Hooks.on("updateSetting", doc => {
    if (doc.key === `${ID}.links`) { manager.refresh(); invalidate(); }
    if (doc.key === `${ID}.encounters`) invalidate();
  });
  Hooks.on("preCreateToken", token => {
    if (token.getFlag(ID, "link")) token.updateSource({ [`flags.${ID}.-=link`]: null });
  });
  // A small heartbeat runs only while the inspector is open; selection sync uses native events.
  setInterval(invalidate, 5000);
});
