// Hive #7: test the actual Core diff and guarded navigation, without a build.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { compare, resultText } from "../src/core/app/sync-conflict-diff.ts";
import { documentFromText as doc } from "../src/core/app/coreDocument.ts";
import { ExtensionHost, activateNoticeAction } from "../src/core/extensions/host.ts";
import { readConflictDescriptors } from "../plugins/shared/sync-merge.js";

const c=compare(doc("common\ncurrent\nend"),doc("common\nsaved\nend"));
assert.equal(c.hunks.length,1);
assert.throws(()=>resultText(c,[]),/unreviewed/);
assert.equal(resultText(c,["current"]),"common\ncurrent\nend");
assert.equal(resultText(c,["saved"]),"common\nsaved\nend");
assert.equal(resultText(c,["both"]),"common\ncurrent\n\nsaved\nend");
for(const [a,b] of [["a\nremove\nb","a\nb"],["a\nb","a\nadded\nb"],["","new"],["old",""]]) {
  const c=compare(doc(a),doc(b));assert.equal(resultText(c,c.hunks.map(()=>"current")),a);assert.equal(resultText(c,c.hunks.map(()=>"saved")),b);
}
const fenced="before\n```mermaid\ngraph TD\nA-->B\n```\n![local](media/abc.png)";
const next=fenced.replace("A-->B","A-->C");
const f=compare(doc(fenced),doc(next));assert.equal(f.hunks.length,1);assert.equal(f.hunks[0].e-f.hunks[0].s,1);
assert.equal(resultText(f,["saved"]),next);assert.ok(resultText(f,["both"]).includes("```\n\n```mermaid"));
for(const bad of ["bad",JSON.stringify({type:"doc",content:[{type:"heading"}]}),doc("```unclosed"),doc("```notible-table\n{}\n```"),"x".repeat(2_000_001),doc(Array(20_001).fill("x").join("\n"))])assert.equal(compare(bad,doc("x")),null);
assert.equal(compare(doc(""),doc(Array(2001).fill("x").join("\n"))),null);
// Deterministic diverse edits: selecting a whole side must reproduce it exactly.
let seed=71;const rng=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
for(let n=0;n<200;n++) {
  const a=Array.from({length:30},()=>String(rng()%12)),b=[...a];
  for(let j=0;j<5;j++)b.splice(rng()%(b.length+1),rng()%2,...(rng()%2?[String(rng()%12)]:[]));
  const c=compare(doc(a.join("\n")),doc(b.join("\n")));
  assert.equal(resultText(c,c.hunks.map(()=>"current")),a.join("\n"));assert.equal(resultText(c,c.hunks.map(()=>"saved")),b.join("\n"));
}
const ids=["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002"];
const descriptor={originalId:ids[0],copyId:ids[1],fields:["content"]};
assert.deepEqual(readConflictDescriptors({objects:ids.map(id=>({id})),conflicts:[descriptor,descriptor]}),[descriptor]);
assert.deepEqual(readConflictDescriptors({objects:[],conflicts:[descriptor]}),[]);
assert.deepEqual(readConflictDescriptors({objects:ids.map(id=>({id})),conflicts:[{...descriptor,fields:["run"]}]}),[]);

let gesture=false,context;const calls=[];
const host=new ExtensionHost(undefined,{openSyncConflicts:async(plugin,id)=>calls.push([plugin,id])});
host.setUserGestureCheck(()=>gesture);
await host.enable({manifest:{id:"example.resolver",name:"Resolver",version:"1.0.0",apiVersion:"1.26",permissions:["workspace.ui"]},onload(ctx){context=ctx;}});
await assert.rejects(context.ui.openSyncConflicts(ids[1]),/only works/);
gesture=true;await context.ui.openSyncConflicts(ids[1]);assert.deepEqual(calls,[["example.resolver",ids[1]]]);
await assert.rejects(context.ui.openSyncConflicts(),/too soon/);
const noPermission=new ExtensionHost();let denied;noPermission.setUserGestureCheck(()=>true);
await noPermission.enable({manifest:{id:"example.denied",name:"Denied",version:"1.0.0",apiVersion:"1.26"},onload(ctx){denied=ctx;}});
await assert.rejects(denied.ui.openSyncConflicts(),/workspace.ui/);

// Hive #7 review: exercise the real view's callbacks without rendering/building
// the app. JSX is an inert tree; hook fixtures supply one reviewed comparison.
const viewCode=ts.transpileModule(readFileSync(new URL("../src/core/app/SyncConflictView.tsx",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022},
}).outputText;
const english=JSON.parse(readFileSync(new URL("../locales/en.json",import.meta.url),"utf8")).strings.app;
const polish=JSON.parse(readFileSync(new URL("../locales/pl.json",import.meta.url),"utf8")).strings.app;
const undoFailure="Could not undo. The saved version is in Trash and the earlier text is in Version history.";
const copyMissing="Could not undo because the saved version was permanently deleted. The earlier text is in Version history.";
for(const key of [undoFailure,copyMissing]) {
  assert.equal(english[key],key);
  assert.ok(polish[key] && polish[key]!==key,"the Undo notice has Polish text");
}
function viewFixture({undoResult,undoError,flushError,discard=null,chosen=true,locale=english}={}) {
  const pair={original:{id:ids[0],title:"Original",content:doc("current")},copy:{id:ids[1],content:doc("saved")},descriptor,originalStamp:"o",copyStamp:"c"};
  const comparison=compare(pair.original.content,pair.copy.content);
  const states=[pair,comparison,chosen?["current"]:[],false,false,"",0,0,[],false,"",[],discard];
  let stateIndex=0,refIndex=0,flushes=0,undoCalls=0,closes=0;
  const notices=[],effects=[],handlers=new Map(),stateWrites=[];
  const inside={},outside={},root={contains:target=>target===inside};
  const hooks={useState:()=>{const i=stateIndex++;return [states[i],value=>stateWrites.push([i,value])];},useRef:value=>({current:refIndex++===0?root:value}),useEffect:fn=>effects.push(fn)};
  const jsx=(type,props)=>({type,props});
  const api={conflictPair:async()=>pair,resolveConflict:async()=>({original:pair.original,undoToken:"receipt",copyTrashed:true}),undoConflict:async()=>{undoCalls++;if(undoError)throw undoError;return undoResult;}};
  const exports={};
  runInNewContext(viewCode,{exports,require:name=>{
    if(name==="react")return hooks;
    if(name==="react/jsx-runtime")return {jsx,jsxs:jsx};
    if(name.endsWith("core-data-api.ts"))return api;
    if(name.endsWith("coreDocument.ts"))return {documentFromText:doc};
    if(name.endsWith("sync-conflict-diff.ts"))return {compare,resultText};
    if(name.endsWith(".css"))return {};
    throw Error(`Unexpected view import ${name}`);
  },window:{addEventListener:(name,fn)=>handlers.set(name,fn),removeEventListener:()=>{}},document:{addEventListener:()=>{},removeEventListener:()=>{}}});
  const tree=exports.SyncConflictView({copyId:ids[1],t:key=>locale[key]??key,beforeAction:async()=>{if(++flushes>1 && flushError)throw flushError;},onClose:()=>closes++,onOpen:async()=>{},onChanged:()=>{},onNotice:(text,action)=>notices.push({text,action})});
  const elements=node=>!node || typeof node!=="object"?[]:Array.isArray(node)?node.flatMap(elements):[node,...elements(node.props?.children)];
  const apply=elements(tree).find(node=>node.type==="button" && node.props.children===locale["Apply resolution"]);
  return {notices,stateWrites,apply:()=>apply.props.onClick(),installKeys:()=>effects.at(-1)(),escape:target=>{
    const event={key:"Escape",target,prevented:false,stopped:false,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};
    handlers.get("keydown")(event);return event;
  },inside,outside,get closes(){return closes;},get undoCalls(){return undoCalls;}};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
for(const locale of [english,polish]) {
  for(const options of [{undoError:Error("not_found")},{undoError:Error("database error")},{flushError:Error("unsaved draft")},{undoResult:{original:null,copyMissing:true,keptNewer:false}},{undoResult:{original:null,copyMissing:false,keptNewer:true}},{undoResult:{original:null,copyMissing:false,keptNewer:false}}]) {
    const f=viewFixture({...options,locale});f.apply();await tick();
    assert.equal(f.closes,1,"Apply closes the view before Undo is clicked");
    const writes=f.stateWrites.length;f.notices[0].action.run();await tick();
    const expected=options.undoError || options.flushError?undoFailure:options.undoResult.copyMissing?copyMissing:options.undoResult.keptNewer?"Newer edits were kept. The saved version is available for review.":"Resolution undone.";
    assert.equal(f.notices[1].text,locale[expected]);
    assert.equal(f.stateWrites.length,writes,"Undo reports through the notice, never through an unmounted view's state");
    assert.equal(f.undoCalls,options.flushError?0:1,"a failed draft flush prevents Undo");
  }
}
for(const chosen of [false,true]) {
  const f=viewFixture({chosen});f.installKeys();
  assert.equal(f.escape(f.outside).stopped,false,"Escape from a palette/menu outside the resolver is left alone");
  assert.equal(f.closes,0);assert.equal(f.stateWrites.length,0);
  assert.equal(f.escape(f.inside).stopped,true);
  assert.equal(f.closes,chosen?0:1,"Escape inside the resolver closes only when there are no choices to discard");
  if(chosen)assert.equal(f.stateWrites.at(-1)[0],12,"reviewed choices request a discard dialog");
}
const dialog=viewFixture({discard:()=>{}});dialog.installKeys();
assert.equal(dialog.escape(dialog.outside).stopped,true,"an open discard dialog still owns Escape");
assert.deepEqual(dialog.stateWrites,[[12,null]]);

// Review F4 is already handled by the host: both synchronous throws and the
// rejected navigation promise (e.g. a fast second click) are observed.
const warnings=[],warn=console.warn;console.warn=(...args)=>warnings.push(args);
try {
  const actionHost=new ExtensionHost(undefined,{openSyncConflicts:async()=>{}});let actionContext;
  actionHost.setUserGestureCheck(()=>true);
  await actionHost.enable({manifest:{id:"example.notice",name:"Notice",version:"1.0.0",apiVersion:"1.26",permissions:["workspace.ui"]},onload(ctx){actionContext=ctx;}});
  await actionContext.ui.openSyncConflicts();
  activateNoticeAction({isTrusted:true},()=>{},()=>{throw Error("sync");});
  activateNoticeAction({isTrusted:true},()=>{},()=>actionContext.ui.openSyncConflicts());
  await tick();assert.equal(warnings.length,2);
  assert.match(String(warnings[1][1]),/too soon/);
} finally {console.warn=warn;}
console.log("sync conflict Core checks passed (choices, bounded diff, pairing, API gate, closed-view Undo, scoped Escape, notice rejection)");
