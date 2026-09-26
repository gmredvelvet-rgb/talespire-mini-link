import { ID, VERSION, SCHEMA, one, keyOf, check, emptyRegistry, fingerprint, selectionPlan } from "./model.js";
import { TaleSpireAdapter, FoundryAdapter, StorageService } from "./adapters.js";
import { LinkManager } from "./link-manager.js";

const t = key => game.i18n.localize(`TML.${key}`);
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
function button(action, icon, label, disabled = false, data = "") {
  return `<button type="button" data-action="${action}" ${data} ${disabled ? "disabled" : ""} title="${esc(t(label))}"><i class="fa-solid ${icon}" inert></i><span>${esc(t(label))}</span></button>`;
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
      rebuild: async function() { await this.perform(recoverWithConfirmation); }
    }
  };
  state = { connected: false, selection: [], tokens: [], links: [], failure: null };
  busy = false;
  async perform(work) {
    if (this.busy) return;
    this.busy = true;
    try { await work(); } catch (error) { report(error); }
    finally { this.busy = false; await refreshPanel(); }
  }
  async _renderHTML() {
    const root = document.createElement("div");
    root.className = "tml-body";
    const { connected, selection, tokens, links, failure, hello } = this.state;
    const selected = selection.length === 1 ? selection[0] : null;
    const canWrite = game.user.isGM && game.users.activeGM?.id === game.user.id;
    const miniLabel = selected?.name ?? t(selection.length ? "manyMinis" : "noMini");
    const tokenLabel = tokens.length === 1 ? tokens[0].name : t(tokens.length ? "manyTokens" : "noToken");
    root.innerHTML = `
      <div class="tml-connection"><span>TaleSpire: <b>${esc(t(connected ? "connected" : "disconnected"))}</b></span><span>Foundry: <b>${esc(t(game.socket?.connected ? "connected" : "disconnected"))}</b></span></div>
      <div class="tml-status">Mini Bridge: ${esc(t(connected ? "ready" : "disconnected"))}</div>
      ${failure ? `<p class="tml-notice" role="status">${esc(failure)}</p>` : ""}
      <dl class="tml-selection"><dt>${esc(t("mini"))}</dt><dd>${esc(miniLabel)}</dd><dt>${esc(t("token"))}</dt><dd>${esc(tokenLabel)}</dd></dl>
      <div class="tml-actions">${button("link", "fa-link", "link", !canWrite || !connected || !selected || tokens.length !== 1)}${button("refresh", "fa-rotate", "refresh")}</div>
      ${game.user.isGM && !canWrite ? `<p class="tml-notice">${esc(t("activeGMOnly"))}</p>` : ""}
      <h3>${esc(t("savedLinks"))} (${links.length})</h3>
      <div class="tml-links">${links.map(({ record, status, token }) => {
        const key = keyOf(record.campaignId, record.creatureId);
        const current = selected && key === keyOf(selected.campaignId, selected.id);
        const data = `data-key="${esc(key)}"`;
        return `<article class="tml-link ${current ? "tml-current" : ""}">
          <strong>${esc(current ? selected.name || record.creatureId : record.creatureId)}</strong>
          <div>${esc(token?.name ?? record.tokenUuid)} / ${esc(token?.actorName ?? record.actorUuid)}</div>
          <div class="tml-status">${esc(t(status))}${record.syntheticActor ? ` / ${esc(t("synthetic"))}` : ""}</div>
          <div class="tml-actions">${button("select", "fa-crosshairs", "select", status !== "linked", data)}${button("sheet", "fa-address-card", "sheet", status !== "linked", data)}${button("inspect", "fa-circle-info", "inspect", !connected || hello?.campaignId !== record.campaignId, data)}${button("unlink", "fa-link-slash", "unlink", !canWrite, data)}</div>
          <details><summary>${esc(t("identifiers"))}</summary><dl><dt>Creature ID</dt><dd>${esc(record.creatureId)}</dd><dt>Token UUID</dt><dd>${esc(record.tokenUuid)}</dd><dt>Actor UUID</dt><dd>${esc(record.actorUuid)}</dd><dt>Campaign ID</dt><dd>${esc(record.campaignId)}</dd></dl></details>
        </article>`;
      }).join("") || `<p>${esc(t("empty"))}</p>`}</div>
      ${canWrite ? button("rebuild", "fa-screwdriver-wrench", "rebuild") : ""}
      ${setting("debug") ? `<pre class="tml-debug">${esc(JSON.stringify({ protocol: SCHEMA, module: VERSION, symbiote: hello?.symbioteVersion, foundry: game.version, capabilities: hello?.capabilities, combat: adapter.getCurrentCombatant() }, null, 2))}</pre>` : ""}`;
    return root;
  }
  _replaceHTML(result, content) { content.replaceChildren(result); }
}

async function snapshotTaleSpire() {
  const hello = await ts.hello();
  const selection = await ts.getSelectedCreatures();
  return { hello, selection };
}
async function refreshPanel() {
  if (!panel?.rendered || !setting("enabled")) return;
  if (refreshing || panel.busy) { pendingRefresh = true; return; }
  refreshing = true;
  try {
    const state = { connected: false, selection: [], tokens: adapter.getSelectedTokens().filter(x => adapter.canRead(x)).map(x => adapter.normalize(x)), links: await manager.visibleLinks() };
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
    rebuild: recoverWithConfirmation
  });
  const invalidate = () => { if (panel?.rendered) void refreshPanel(); };
  window.addEventListener("tml:selection", () => { invalidate(); void syncSelection(); });
  window.addEventListener("frb:talespire-ready", invalidate);
  for (const name of ["controlToken", "canvasReady", "updateToken", "deleteToken", "deleteScene", "deleteActor", "updateActor", "updateCombat", "deleteCombat", "updateUser"]) Hooks.on(name, invalidate);
  Hooks.on("updateSetting", doc => { if (doc.key === `${ID}.links`) { manager.refresh(); invalidate(); } });
  Hooks.on("preCreateToken", token => {
    if (token.getFlag(ID, "link")) token.updateSource({ [`flags.${ID}.-=link`]: null });
  });
  // A small heartbeat runs only while the inspector is open; selection sync uses native events.
  setInterval(invalidate, 5000);
});
