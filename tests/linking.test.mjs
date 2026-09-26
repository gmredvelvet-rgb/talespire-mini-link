import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { emptyRegistry, indexes, keyOf, one, putLink, removeLink, fingerprint, conflicts, recoverLinks, timeout, selectionPlan, PROTOCOL } from '../scripts/model.js';
import { LinkManager } from '../scripts/link-manager.js';
import { FoundryAdapter, StorageService, TaleSpireAdapter } from '../scripts/adapters.js';
import { emptyEncounters, validateEncounters, createEncounter, renameEncounter, deleteEncounter, assignMinis, encounterOf, sortedEncounters, suggestName } from '../scripts/encounters.js';

const campaign = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const mini = n => `bbbbbbbb-bbbb-bbbb-bbbb-${String(n).padStart(12, '0')}`;
const uuid = n => `Scene.AAAAAAAAAAAAAAAA.Token.${String(n).padStart(16, '0')}`;
const record = n => ({version:1, linkId:`link${n}`,campaignId:campaign,creatureId:mini(n),tokenUuid:uuid(n),actorUuid:'Actor.BBBBBBBBBBBBBBBB',syntheticActor:false});
const add = (r, value) => putLink(r,value,fingerprint(conflicts(r,keyOf(value.campaignId,value.creatureId),value.tokenUuid))).next;

test('zero and multiple selection rejected for minis and tokens', () => {
  for(const kind of ['Mini','Token']) {
    assert.throws(()=>one([],`no${kind}`,`many${kind}s`), {code:`no${kind}`});
    assert.throws(()=>one([1,2],`no${kind}`,`many${kind}s`), {code:`many${kind}s`});
  }
  assert.equal(one([1],'empty','many'),1);
});
test('five identical names remain independent and survive serialized restart', () => {
  let r=emptyRegistry();
  for(let n=1;n<=5;n++) r=add(r,{...record(n),tokenName:'Goblin',creatureName:'Goblin'});
  const index=indexes(JSON.parse(JSON.stringify(r)));
  assert.equal(index.byCreatureId.size,5);
  for(let n=1;n<=5;n++) assert.equal(index.byTokenUuid.get(uuid(n)).creatureId,mini(n));
});
test('replacement removes both conflicting associations, preserving unrelated links', () => {
  let r=add(add(add(emptyRegistry(),record(1)),record(2)),record(3));
  const replacement={...record(1),tokenUuid:uuid(2),linkId:'new'};
  const result=putLink(r,replacement,fingerprint(conflicts(r,keyOf(campaign,mini(1)),uuid(2))));
  assert.equal(Object.keys(result.next.links).length,2);
  assert.deepEqual(new Set(result.next.retired),new Set(['link1','link2']));
  assert.equal(indexes(result.next).byTokenUuid.has(uuid(1)),false);
  assert.equal(Object.keys(r.links).length,3);
});
test('stale confirmation cannot replace a newer association', () => {
  const r=add(emptyRegistry(),record(1));
  assert.throws(()=>putLink(r,{...record(1),linkId:'new'},fingerprint([])),{code:'changed'});
  assert.throws(()=>removeLink(r,keyOf(campaign,mini(1)),'stale'),{code:'changed'});
});
test('unlink tombstone prevents resurrection even if flag cleanup failed', () => {
  const r=add(emptyRegistry(),record(1));
  const removed=removeLink(r,keyOf(campaign,mini(1)),'link1').next;
  const result=recoverLinks(removed,[{uuid:uuid(1),record:record(1)}]);
  assert.equal(result.recovered,0); assert.equal(result.skipped,1);
});
test('copying token or scene cannot steal original association', () => {
  const mirrors=[{uuid:uuid(2),record:record(1)},{uuid:uuid(1).replace('AAAAAAAAAAAAAAAA','CCCCCCCCCCCCCCCC'),record:record(1)},{uuid:uuid(1),record:record(1)}];
  const result=recoverLinks(emptyRegistry(),mirrors);
  assert.equal(result.recovered,1); assert.equal(result.skipped,2);
  assert.equal(indexes(result.next).byTokenUuid.size,1);
});
test('ambiguous recovery rejected', () => {
  const result=recoverLinks(emptyRegistry(),[{uuid:uuid(1),record:record(1)},{uuid:uuid(2),record:{...record(1),tokenUuid:uuid(2),linkId:'other'}}]);
  assert.equal(result.recovered,0);assert.equal(result.skipped,2);
});
test('timeout is bounded and successful requests complete',async()=>{
  await assert.rejects(timeout(new Promise(()=>{}),5),{code:'timeout'});
  assert.equal(await timeout(Promise.resolve(42),50),42);
});

function harness() {
  globalThis.game={user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}}};
  let registry=emptyRegistry(), selected=uuid(1);
  const tokens=new Map([1,2].map(n=>[uuid(n),{uuid:uuid(n),name:'Same name',actorUuid:record(n).actorUuid,syntheticActor:false}]));
  const storage={read:()=>structuredClone(registry),write:async r=>{registry=structuredClone(r);},assertWriter:()=>StorageService.prototype.assertWriter(),mirror:async()=>false,mirrors:()=>[]};
  const adapter={getTokenByUuid:async id=>{if(!tokens.has(id)) throw Object.assign(new Error(),{code:'missingToken'});return tokens.get(id);},getSelectedToken:()=>tokens.get(selected),normalize:t=>t};
  return {manager:new LinkManager(storage,adapter),storage,tokens,select:id=>{selected=id;}};
}
test('manager persists link, restart resolves it, unlink does not delete token',async()=>{
  const h=harness();
  const preview=h.manager.preview({id:mini(1),campaignId:campaign},h.tokens.get(uuid(1)));
  await h.manager.link(preview);
  const restarted=new LinkManager(h.storage,h.manager.foundry);
  assert.equal((await restarted.visibleLinks())[0].status,'linked');
  await restarted.unlink(restarted.byTokenUuid.get(uuid(1)));
  assert.equal(h.tokens.size,2);assert.equal(restarted.byTokenUuid.size,0);
});
test('manager refuses changed token selection and player writes',async()=>{
  const h=harness();const p=h.manager.preview({id:mini(1),campaignId:campaign},h.tokens.get(uuid(1)));
  h.select(uuid(2));await assert.rejects(h.manager.link(p),{code:'changed'});
  game.user.isGM=false;await assert.rejects(h.manager.link(p),{code:'gmOnly'});
  game.user.isGM=true;game.users.activeGM.id='other';await assert.rejects(h.manager.link(p),{code:'activeGMOnly'});
});
test('recovery requires approval of exact candidate records',async()=>{
  const h=harness();h.storage.mirrors=()=>[{uuid:uuid(1),record:record(1)}];
  const preview=h.manager.previewRecovery();
  await assert.rejects(h.manager.rebuild(),{code:'changed'});
  const expected=fingerprint(Object.values(preview.next.links));
  h.storage.mirrors=()=>[{uuid:uuid(2),record:record(2)}];
  await assert.rejects(h.manager.rebuild(expected),{code:'changed'});
  h.storage.mirrors=()=>[{uuid:uuid(1),record:record(1)}];
  assert.equal((await h.manager.rebuild(expected)).recovered,1);
});
test('missing token and replaced actor do not fall back to world actors',async()=>{
  const h=harness();await h.manager.link(h.manager.preview({id:mini(1),campaignId:campaign},h.tokens.get(uuid(1))));
  h.tokens.get(uuid(1)).actorUuid='Actor.CCCCCCCCCCCCCCCC';
  assert.equal((await h.manager.visibleLinks())[0].status,'changedActor');
  h.tokens.delete(uuid(1));assert.equal((await h.manager.visibleLinks())[0].status,'missingToken');
  game.user.isGM=false;assert.equal((await h.manager.visibleLinks()).length,0);
});
test('Foundry adapter preserves synthetic actor and full scene UUID',async()=>{
  harness();const adapter=new FoundryAdapter();
  const doc={documentName:'Token',uuid:uuid(1),id:'0000000000000001',parent:{documentName:'Scene',uuid:'Scene.AAAAAAAAAAAAAAAA'},actor:{uuid:uuid(1)+'.Actor.BBBBBBBBBBBBBBBB',name:'Synthetic',isToken:true}};
  globalThis.fromUuid=async id=>id===doc.uuid?doc:null;
  assert.equal(adapter.normalize(await adapter.getTokenByUuid(uuid(1))).syntheticActor,true);
  assert.equal(adapter.getActorFromToken(doc),doc.actor);
  await assert.rejects(adapter.getTokenByUuid(uuid(2)),{code:'missingToken'});
  game.user.isGM=false;doc.actor.testUserPermission=()=>true;doc.hidden=true;
  assert.throws(()=>adapter.normalize(doc),{code:'permission'});
});
test('selection plan targets the other side and never swaps the attacker', () => {
  const me={own:true,id:'me'}, orc={own:false,id:'orc'}, ogre={own:false,id:'ogre'};
  const on={autoTarget:true,autoSelect:true};
  assert.deepEqual(selectionPlan([orc],on),{targets:[orc],control:null});
  assert.deepEqual(selectionPlan([me],on),{targets:[],control:me});
  assert.deepEqual(selectionPlan([me,orc,ogre],on),{targets:[orc,ogre],control:me});
  assert.deepEqual(selectionPlan([orc],{autoTarget:true,autoSelect:false}),{targets:[orc],control:null});
  // Targeting off keeps the 1.3 behaviour: control the single linked mini.
  assert.deepEqual(selectionPlan([orc],{autoTarget:false,autoSelect:true}),{targets:[],control:orc});
  assert.deepEqual(selectionPlan([me,orc],{autoTarget:false,autoSelect:true}).control,null);
  assert.deepEqual(selectionPlan([],on),{targets:[],control:null});
});

function targetingHarness({isGM=false}={}) {
  const calls=[];
  const doc=(n,extra={})=>({id:String(n).padStart(16,'0'),actorId:'BBBBBBBBBBBBBBBB',actorLink:true,hidden:false,isOwner:false,...extra});
  const placed=new Map([1,2,3].map(n=>[String(n).padStart(16,'0'),{id:String(n).padStart(16,'0'),document:doc(n),actor:{hasPlayerOwner:false}}]));
  globalThis.game={user:{id:'u',isGM,targets:new Set()},settings:{get:()=>false}};
  globalThis.canvas={ready:true,scene:{id:'AAAAAAAAAAAAAAAA'},tokens:{get:id=>placed.get(id),setTargets:(ids,opts)=>{calls.push([ids,opts]);game.user.targets=new Set(ids.map(id=>placed.get(id)));}}};
  return {adapter:new FoundryAdapter(),placed,calls};
}
test('enemy tokens are targetable without actor permission, but identity still checked', () => {
  const {adapter,placed}=targetingHarness();
  // No actor access at all — a player facing an enemy they cannot observe.
  assert.equal(adapter.targetableToken(record(1)).id,'0000000000000001');
  placed.get('0000000000000001').document.actorId='CCCCCCCCCCCCCCCC';
  assert.throws(()=>adapter.targetableToken(record(1)),{code:'changedActor'});
  assert.throws(()=>adapter.targetableToken({...record(2),syntheticActor:true}),{code:'changedActor'});
  placed.get('0000000000000002').document.hidden=true;
  assert.throws(()=>adapter.targetableToken(record(2)),{code:'permission'});
  assert.throws(()=>adapter.targetableToken({...record(3),tokenUuid:'Scene.CCCCCCCCCCCCCCCC.Token.0000000000000003'}),{code:'otherScene'});
  assert.throws(()=>adapter.targetableToken(record(4)),{code:'missingToken'});
  canvas.ready=false;
  assert.throws(()=>adapter.targetableToken(record(3)),{code:'noCanvas'});
});
test('synthetic actors match by base actor id and GM-hidden tokens stay targetable for the GM', () => {
  const {adapter,placed}=targetingHarness({isGM:true});
  const synthetic={...record(1),syntheticActor:true,actorUuid:uuid(1)+'.Actor.BBBBBBBBBBBBBBBB'};
  placed.get('0000000000000001').document.actorLink=false;
  placed.get('0000000000000001').document.hidden=true;
  assert.equal(adapter.targetableToken(synthetic).id,'0000000000000001');
});
test('own side: players own their token, the GM plays the tokens no player owns', () => {
  const {adapter,placed}=targetingHarness();
  const pc=placed.get('0000000000000001'), npc=placed.get('0000000000000002');
  pc.document.isOwner=true; pc.actor.hasPlayerOwner=true;
  assert.equal(adapter.isOwnToken(pc),true); assert.equal(adapter.isOwnToken(npc),false);
  game.user.isGM=true; pc.document.isOwner=npc.document.isOwner=true;
  assert.equal(adapter.isOwnToken(pc),false); assert.equal(adapter.isOwnToken(npc),true);
});
test('targets are replaced once and not rebroadcast when unchanged', () => {
  const {adapter,placed,calls}=targetingHarness();
  const a=placed.get('0000000000000001'), b=placed.get('0000000000000002');
  assert.equal(adapter.setTargets([a,b]),true);
  assert.deepEqual(calls,[[[a.id,b.id],{mode:'replace'}]]);
  assert.equal(adapter.setTargets([b,a]),false);
  assert.equal(adapter.setTargets([a]),true);
  assert.equal(calls.length,2);
});
test('panel opens from a Token controls button that follows the v14 SceneControls rules', async () => {
  const hooks={}, settings={enabled:true};
  globalThis.Hooks={on:(n,f)=>(hooks[n]??=[]).push(f),once:(n,f)=>(hooks[n]??=[]).push(f),callAll(){}};
  globalThis.foundry={utils:{randomID:()=>'id'},applications:{api:{ApplicationV2:class {}}}};
  globalThis.game={release:{generation:14},settings:{get:(_,k)=>settings[k],register(){}},i18n:{localize:k=>k,has:()=>false},user:{isGM:true}};
  await import(`../scripts/main.js?scene-controls=${Date.now()}`);
  const run=()=>{const controls={tokens:{name:'tokens',activeTool:'select',tools:{select:{name:'select'},target:{name:'target'}}}};for(const fn of hooks.getSceneControlButtons??[]) fn(controls);return controls.tokens;};
  const tokens=run(), tool=tokens.tools.talespireMiniLinks;
  assert.ok(tool,'tool added to the tokens group');
  assert.equal(tool.name,'talespireMiniLinks');
  assert.equal(tool.button,true);
  assert.equal(typeof tool.onChange,'function');
  assert.equal(tool.onClick,undefined,'onClick would fire a second time in v14');
  assert.equal(tool.toggle,undefined);
  assert.equal(tokens.activeTool,'select','a button must never become the active tool');
  assert.ok(tool.order>2,'placed after the core tools');
  settings.enabled=false;
  assert.equal(run().tools.talespireMiniLinks,undefined,'hidden while the module is disabled');
});
test('soft gate hands the licence to Velvet License Hub and never blocks', async () => {
  const hooks={}, registered=[], settings=[];
  globalThis.Hooks={on:(n,f)=>(hooks[n]??=[]).push(f),once:(n,f)=>(hooks[n]??=[]).push(f),callAll(){}};
  const hub={active:true,api:{apiVersion:1,register:id=>registered.push(id)}};
  globalThis.game={view:'game',release:{generation:14},user:{isGM:true},modules:{get:id=>id==='velvet-license-hub'?hub:null},
    settings:{register:(m,k)=>settings.push(`${m}.${k}`),registerMenu:(m,k)=>settings.push(`menu:${m}.${k}`),get:()=>false,set:async()=>{}},
    i18n:{localize:k=>k}};
  await import(`../scripts/license/boot.js?hub=${Date.now()}`);
  for (const fn of hooks.init) fn();
  assert.deepEqual(settings,['talespire-mini-link.worldLicensed'],'with the hub active there is no per-module licence menu');
  for (const fn of hooks.ready) await fn();
  assert.deepEqual(registered,['talespire-mini-link']);
  game.view='join'; registered.length=0;
  for (const fn of hooks.ready) await fn();
  assert.deepEqual(registered,[],'no licence work outside the game view');
});
test('encounters: zones are disjoint, names unique, deleting keeps the minis', () => {
  let r=emptyEncounters();
  ({next:r}=createEncounter(r,'  A1 ','e1'));
  ({next:r}=createEncounter(r,'A2','e2'));
  assert.equal(r.encounters.e1.name,'A1');
  assert.throws(()=>createEncounter(r,'a1','e3'),{code:'encounterExists'});
  assert.throws(()=>createEncounter(r,'   ','e3'),{code:'encounterName'});
  const k1=keyOf(campaign,mini(1)), k2=keyOf(campaign,mini(2));
  r=assignMinis(r,'e1',[k1,k2]);
  r=assignMinis(r,'e2',[k2]);                 // moving, never duplicating
  assert.deepEqual(r.encounters.e1.members,[k1]);
  assert.equal(encounterOf(r,k2),'e2');
  r=assignMinis(r,null,[k1]);
  assert.equal(encounterOf(r,k1),null);
  r=deleteEncounter(r,'e2');
  assert.equal(encounterOf(r,k2),null);
  assert.throws(()=>renameEncounter(r,'e2','X'),{code:'changed'});
  assert.equal(validateEncounters(JSON.parse(JSON.stringify(r))).revision,r.revision);
  const broken=structuredClone(r); broken.encounters.e1.members=[k1,k1];
  assert.throws(()=>validateEncounters(broken),{code:'conflict'});
});
test('encounters sort as numbers and suggest the next room', () => {
  let r=emptyEncounters();
  for (const [i,n] of ['A10','A2','A1'].entries()) ({next:r}=createEncounter(r,n,`e${i}`));
  assert.deepEqual(sortedEncounters(r).map(e=>e.name),['A1','A2','A10']);
  assert.equal(suggestName(r),'A11');
  assert.equal(suggestName(createEncounter(emptyEncounters(),'Sala 9','x').next),'Sala 10');
  assert.equal(suggestName(createEncounter(emptyEncounters(),'Cripta','x').next),'');
  assert.equal(suggestName(emptyEncounters()),'');
});

test('starting an encounter replaces the combat and the VN enemies, keeping the party', async () => {
  const hooks={}, calls=[], sceneId='AAAAAAAAAAAAAAAA';
  const tok=(id,extra={})=>({id,actorId:`actor-${id}`,hidden:false,actor:{hasPlayerOwner:false},...extra});
  const tokens=[tok('0000000000000001'),tok('0000000000000002',{hidden:true}),tok('pc',{actor:{hasPlayerOwner:true}})];
  let links=emptyRegistry();
  for (const n of [1,2,3]) links=add(links,{...record(n),tokenUuid:n===3?`Scene.CCCCCCCCCCCCCCCC.Token.${String(n).padStart(16,'0')}`:uuid(n),linkId:`l${n}`});
  let enc=createEncounter(emptyEncounters(),'A1','e1').next;
  enc=assignMinis(enc,'e1',[1,2,3].map(n=>keyOf(campaign,mini(n))));
  const store={links,encounters:enc};
  globalThis.Hooks={on:(n,f)=>(hooks[n]??=[]).push(f),once:(n,f)=>(hooks[n]??=[]).push(f),callAll(){}};
  globalThis.foundry={utils:{randomID:()=>'id'},applications:{api:{ApplicationV2:class {},DialogV2:{confirm:async()=>{calls.push('confirm');return true;}}}}};
  globalThis.ui={notifications:{info:m=>calls.push(`info:${m}`),warn:m=>calls.push(`warn:${m}`)}};
  globalThis.canvas={ready:true,scene:{id:sceneId,tokens:{get:id=>tokens.find(t=>t.id===id),filter:fn=>tokens.filter(fn)}}};
  globalThis.Combat={implementation:{create:async data=>{calls.push('create');calls.created=data;}}};
  globalThis.VNEnhanced={getState:()=>({rightCast:[{id:'old-enemy'},{id:'actor-0000000000000001'}],showVN:true,combatMode:true}),
    removeActor:async id=>calls.push(`remove:${id}`),setCombatMode:async on=>calls.push(`combat:${on}`)};
  globalThis.game={release:{generation:14},socket:{connected:true},user:{id:'gm',isGM:true},users:{activeGM:{id:'gm'}},
    combat:{scene:{id:sceneId},delete:async()=>calls.push('delete')},
    modules:(()=>{const own={id:'talespire-mini-link',api:null};return {get:id=>id==='vnd-enhanced'?{active:true}:own};})(),
    settings:{get:(_,k)=>k==='enabled'?true:store[k],register(){},set:async(_,k,v)=>{store[k]=v;}},
    i18n:{localize:(k,d)=>d?`${k}${JSON.stringify(d)}`:k,has:()=>true}};
  await import(`../scripts/main.js?encounter=${Date.now()}`);
  for (const fn of hooks.init??[]) fn();
  // ready wires window events and a heartbeat interval; neither exists here,
  // and a real interval would keep the test process alive.
  const realInterval=globalThis.setInterval;
  globalThis.window={addEventListener(){}}; globalThis.setInterval=()=>0;
  try { for (const fn of hooks.ready??[]) await fn(); }
  finally { globalThis.setInterval=realInterval; }
  const api=game.modules.get('talespire-mini-link').api;
  await api.startEncounter('a1');             // by name, any case
  // Order matters: VN would put its whole cast into the new combat.
  assert.deepEqual(calls.slice(0,4),['confirm','delete','remove:old-enemy','create']);
  assert.ok(!calls.includes('remove:actor-0000000000000001'),'enemies of the new room stay');
  assert.deepEqual(calls.created.combatants.map(c=>c.tokenId).sort(),['0000000000000001','0000000000000002','pc']);
  assert.equal(calls.created.combatants.find(c=>c.tokenId==='0000000000000002').hidden,true);
  assert.equal(calls.created.active,true);
  assert.ok(calls.includes('combat:true'));
  assert.ok(calls.some(c=>c.startsWith('warn:TML.encElsewhere')),'the mini on another scene is reported');
});
test('token HUD copies the token name in two clicks, once per HUD', async () => {
  const hooks={}, copied=[], notes=[], settings={enabled:true};
  globalThis.Hooks={on:(n,f)=>(hooks[n]??=[]).push(f),once:(n,f)=>(hooks[n]??=[]).push(f),callAll(){}};
  globalThis.foundry={utils:{randomID:()=>'id'},applications:{api:{ApplicationV2:class {}}}};
  globalThis.ui={notifications:{info:m=>notes.push(m),warn:m=>notes.push(`warn:${m}`)}};
  globalThis.game={release:{generation:14},settings:{get:(_,k)=>settings[k],register(){}},i18n:{localize:(k,d)=>d?`${k}:${d.name}`:k,has:()=>true},
    user:{isGM:false},clipboard:{copyPlainText:async text=>{copied.push(text);}}};
  const el=()=>{const e={dataset:{},attrs:{},listeners:{},setAttribute(k,v){e.attrs[k]=v;},addEventListener(n,f){e.listeners[n]=f;}};return e;};
  globalThis.document={createElement:el};
  const column={children:[],querySelector(sel){return this.children.find(c=>sel==='.tml-copy-name'&&c.className.includes('tml-copy-name'))??null;},append(c){this.children.push(c);}};
  const html={querySelector:sel=>sel==='.col.left'?column:null};
  const hud={document:{name:'Ornery Bugbear (1)'}};
  await import(`../scripts/main.js?hud=${Date.now()}`);
  const render=()=>{for (const fn of hooks.renderTokenHUD??[]) fn(hud,html);};
  render(); render();
  assert.equal(column.children.length,1,'re-rendering the HUD does not stack buttons');
  const btn=column.children[0];
  assert.match(btn.className,/control-icon/);
  assert.equal(btn.attrs['aria-label'],'TML.copyName');
  btn.listeners.click({preventDefault(){},stopPropagation(){}});
  await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(copied,['Ornery Bugbear (1)']);
  assert.ok(notes.some(n=>n.includes('Ornery Bugbear (1)')));
  settings.enabled=false; column.children.length=0; render();
  assert.equal(column.children.length,0,'no button while the module is disabled');
});
test('reply correlation and version checked',async()=>{
  globalThis.foundry={utils:{randomID:()=> 'req'}};
  globalThis.TML_SYMBIOTE={request:async q=>({...q,ok:true,payload:42,requestId:'wrong'})};
  await assert.rejects(new TaleSpireAdapter().hello(),{code:'invalidResponse'});
  TML_SYMBIOTE.request=async q=>({...q,ok:true,version:999});
  await assert.rejects(new TaleSpireAdapter().hello(),{code:'versionMismatch'});
  delete globalThis.TML_SYMBIOTE;
});
test('real extra exposes only official read operations and leaves dice callbacks untouched',{skip:!process.env.TML_SYMBIOTE_PATH},async()=>{
  const extra=process.env.TML_SYMBIOTE_PATH;
  assert.ok(extra,'Set TML_SYMBIOTE_PATH to the installed extra when running integration tests');
  const roll=()=>42, events=[];
  const context=vm.createContext({setTimeout,clearTimeout,TS:{creatures:{getSelectedCreatures:async()=>[{id:mini(1)}],getMoreInfo:async()=>[{id:mini(1),name:'Same name'}]},campaigns:{whereAmI:async()=>({id:campaign})}},frbHandleTaleSpireRollEvent:roll,window:{dispatchEvent:e=>events.push(e.type)},CustomEvent:class {constructor(type){this.type=type;}}});
  vm.runInContext(readFileSync(extra,'utf8'),context);
  const send=(type,payload={})=>context.TML_SYMBIOTE.request({protocol:PROTOCOL,version:1,requestId:'test',type,payload});
  const hello=await send('HELLO');assert.equal(hello.ok,true);assert.equal(hello.payload.capabilities.selectCreature,false);
  const selected=await send('GET_SELECTED_CREATURES');assert.equal(selected.payload[0].id,mini(1));
  assert.equal((await send('DELETE_TOKEN')).error,'unsupported');
  assert.equal((await send('GET_CREATURE_INFO',{id:'bad'})).error,'invalidId');
  assert.equal(context.frbHandleTaleSpireRollEvent,roll);
  context.tmlCreatureSelectionChanged();assert.deepEqual(events,['tml:selection']);
});
