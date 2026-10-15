import { useEffect, useRef, useState } from "react";
import type { PluginObject } from "../../../packages/plugin-api/src/index.ts";
import { conflictPair, conflictQueue, resolveConflict, searchObjects, undoConflict, type ConflictPair } from "../data/core-data-api.ts";
import { documentFromText } from "./coreDocument.ts";
import { compare, resultText, type Choice, type Comparison } from "./sync-conflict-diff.ts";
import "./sync-conflicts.css";

type Translate = (key:string, values?:Record<string,string|number>)=>string;
// Hive #7: same Core view for both plugins, usable with neither enabled.
export function SyncConflictView({copyId, t, beforeAction, onClose, onOpen, onChanged, onNotice}: {
  copyId?:string; t:Translate; beforeAction:()=>Promise<void>; onClose:()=>void;
  onOpen:(id:string)=>Promise<void>; onChanged:(object:PluginObject)=>void;
  onNotice:(text:string,action?:{label:string;run:()=>void})=>void;
}) {
  const [pair,setPair]=useState<ConflictPair|null>(null),[comparison,setComparison]=useState<Comparison|null>(null);
  const [choices,setChoices]=useState<(Choice|undefined)[]>([]),[busy,setBusy]=useState(false),[stale,setStale]=useState(false);
  const [error,setError]=useState(""),[offset,setOffset]=useState(0),[hunkPage,setHunkPage]=useState(0);
  const [queue,setQueue]=useState<Awaited<ReturnType<typeof conflictQueue>>>([]);
  const [unlinked,setUnlinked]=useState(false),[query,setQuery]=useState(""),[candidates,setCandidates]=useState<PluginObject[]>([]);
  const [discard,setDiscard]=useState<(()=>void)|null>(null);
  const root=useRef<HTMLElement|null>(null),sequence=useRef(0),skipLeave=useRef(false);
  const chosen=choices.some(Boolean),remaining=comparison ? comparison.hunks.filter((_,i)=>!choices[i]).length : 0;
  const canApply=!!pair && !!comparison && remaining===0 && !busy && !stale;

  function explain(value:unknown) {
    const code=String(value);
    if(code.includes("conflict")) {setStale(true);setError(t("This note changed. Review it again."));}
    else setError(t("Could not open or save this comparison. Your notes are unchanged. Try again."));
  }
  async function pick(id:string,originalId?:string) {
    const ticket=++sequence.current;setBusy(true);setError("");
    try {
      await beforeAction();const p=await conflictPair(id,originalId);
      if(ticket!==sequence.current) return;
      setPair(p);setComparison(compare(p.original.content,p.copy.content));setChoices([]);setStale(false);setUnlinked(false);setHunkPage(0);
    } catch(e) {
      if(ticket!==sequence.current) return;
      if(String(e).includes("unlinked")) {setPair(null);setComparison(null);setUnlinked(true);} else explain(e);
    } finally {if(ticket===sequence.current)setBusy(false);}
  }
  useEffect(()=>{void conflictQueue(offset).then(setQueue).catch(explain);},[offset]);
  useEffect(()=>{if(copyId) void pick(copyId);else {++sequence.current;setPair(null);setComparison(null);setChoices([]);setUnlinked(false);}},[copyId]);
  useEffect(()=>{root.current?.querySelector<HTMLElement>("h1")?.focus();},[pair?.copy.id]);
  useEffect(()=>()=>{++sequence.current;},[]);
  useEffect(()=>{
    if(!unlinked || !query.trim()) {setCandidates([]);return;}
    let cancelled=false;const timer=setTimeout(()=>{void searchObjects(query,50).then(list=>{if(!cancelled)setCandidates(list.filter(o=>o.id!==copyId && !o.trashed_at && !o.archived_at));}).catch(explain);},200);
    return ()=>{cancelled=true;clearTimeout(timer);};
  },[query,unlinked,copyId]);
  useEffect(()=>{
    if(!pair) return;let stopped=false;
    const changed=()=>void conflictPair(pair.copy.id,pair.original.id).then(next=>{
      if(!stopped && (next.originalStamp!==pair.originalStamp || next.copyStamp!==pair.copyStamp))setStale(true);
    }).catch(()=>{if(!stopped)setStale(true);});
    window.addEventListener("notible:workspace-changed",changed);
    return ()=>{stopped=true;window.removeEventListener("notible:workspace-changed",changed);};
  },[pair]);
  function leave(run:()=>void) {if(busy)return;if(chosen)setDiscard(()=>run);else run();}
  useEffect(()=>{
    const key=(e:KeyboardEvent)=>{
      if(!discard && !root.current?.contains(e.target as Node))return;
      if(e.key==="Escape") {
        e.preventDefault();e.stopImmediatePropagation();
        if(discard)setDiscard(null);else leave(onClose);
      }
      if(discard && e.key==="Tab") {
        const buttons=root.current?.querySelectorAll<HTMLButtonElement>('[role="dialog"] button');
        if(!buttons?.length)return;
        const first=buttons[0],last=buttons[buttons.length-1];
        if(e.shiftKey && document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first.focus();}
      }
    };
    const outside=(e:MouseEvent)=>{
      if(skipLeave.current || !(e.target instanceof Element) || root.current?.contains(e.target))return;
      const target=e.target.closest<HTMLElement>("button,a");if(!target || (!chosen && !busy))return;
      e.preventDefault();e.stopImmediatePropagation();if(busy)return;setDiscard(()=>()=>{skipLeave.current=true;target.click();skipLeave.current=false;});
    };
    window.addEventListener("keydown",key,true);document.addEventListener("click",outside,true);
    return ()=>{window.removeEventListener("keydown",key,true);document.removeEventListener("click",outside,true);};
  },[chosen,busy,discard,onClose]);

  async function fresh() {
    if(!pair) throw Error("not_found");await beforeAction();const current=await conflictPair(pair.copy.id,pair.original.id);
    if(current.originalStamp!==pair.originalStamp || current.copyStamp!==pair.copyStamp)throw Error("conflict");
  }
  async function apply() {
    if(!canApply || !pair || !comparison)return;setBusy(true);setError("");
    try {
      await fresh();const saved=await resolveConflict(pair,documentFromText(resultText(comparison,choices)));
      onChanged(saved.original);setChoices([]);
      onNotice(saved.copyTrashed?t("Conflict resolved. The saved version is in Trash."):t("Text saved. Keep the copy to review its other differences."),{
        label:t("Undo"),run:()=>void (async()=>{try{await beforeAction();const r=await undoConflict(saved.undoToken);if(r.original)onChanged(r.original);
          onNotice(r.copyMissing?t("Could not undo because the saved version was permanently deleted. The earlier text is in Version history."):r.keptNewer?t("Newer edits were kept. The saved version is available for review."):t("Resolution undone."));}catch{onNotice(t("Could not undo. The saved version is in Trash and the earlier text is in Version history."));}})(),
      });await onOpen(saved.original.id);onClose();
    }catch(e){explain(e);}finally{setBusy(false);}
  }
  async function preview(details:HTMLDetailsElement) {
    if(!details.open)return;setBusy(true);try{await fresh();}catch(e){details.open=false;explain(e);}finally{setBusy(false);}
  }
  const result=comparison && !remaining ? resultText(comparison,choices) : "";
  return <section ref={root} className="core-conflicts" aria-label={t("Resolve conflict")} aria-busy={busy}>
    <header className="core-conflicts-head"><div><h1 tabIndex={-1}>{pair?t("Resolve conflict"):t("Review conflicts")}</h1><p>{pair?.original.title || t("Choose a saved version to review.")}</p></div>
      <button type="button" className="core-button core-button-secondary" disabled={busy} onClick={()=>leave(onClose)}>{t("Close")}</button></header>
    <div className="core-conflicts-scroll">
      {(stale || error) && <div className="core-conflicts-warning" role="alert"><p>{stale?t("This note changed. Review it again."):error}</p>
        {pair && <button type="button" className="core-button core-button-secondary" disabled={busy} onClick={()=>leave(()=>void pick(pair.copy.id,pair.original.id))}>{t("Review again")}</button>}
        {!pair && copyId && !unlinked && <button type="button" className="core-button core-button-secondary" disabled={busy} onClick={()=>void pick(copyId)}>{t("Try again")}</button>}</div>}
      {unlinked && <div className="core-conflicts-pair"><h2>{t("Compare with…")}</h2><p>{t("Choose the original note explicitly. This comparison will keep the saved copy.")}</p>
        <input className="core-input" aria-label={t("Search notes")} placeholder={t("Search notes")} value={query} onChange={e=>setQuery(e.target.value)}/>
        {candidates.map(o=><button type="button" className="core-button core-button-secondary" key={o.id} disabled={busy} onClick={()=>void pick(copyId!,o.id)}>{o.title || t("Untitled note")}</button>)}
        {candidates.length===50 && <p>{t("Refine your search to find another note.")}</p>}</div>}
      {!pair && !copyId && <><p>{t("Copies stay safe until you save a resolution.")}</p>
        {queue.map(q=><button type="button" className="core-conflicts-queue core-button core-button-secondary" key={q.descriptor.copyId} disabled={busy} onClick={()=>void pick(q.descriptor.copyId)}><div><strong>{q.title || t("Untitled note")}</strong><small>{q.copyTitle} · {new Date(q.createdAt).toLocaleString()}</small></div><span>{t("Resolve conflict")}</span></button>)}
        {!queue.length && <p>{t("No pending linked conflicts.")}</p>}
        <div className="core-conflicts-pagination"><button type="button" className="core-button core-button-secondary" disabled={!offset || busy} onClick={()=>setOffset(Math.max(0,offset-50))}>{t("Previous")}</button><button type="button" className="core-button core-button-secondary" disabled={queue.length<50 || busy} onClick={()=>setOffset(offset+50)}>{t("Next")}</button></div></>}
      {pair && !comparison && <div><p>{t("This content needs manual comparison. Open both notes; the saved copy will be kept.")}</p><button type="button" className="core-button core-button-secondary" onClick={()=>void onOpen(pair.original.id)}>{t("Open current note")}</button><button type="button" className="core-button core-button-secondary" onClick={()=>void onOpen(pair.copy.id)}>{t("Open saved version")}</button></div>}
      {pair && comparison && <>
        <p className="core-conflicts-intro">{t("Compare the current note with a full saved version. Some differences may already have been merged.")}</p>
        {(!pair.descriptor || pair.descriptor.fields.some(f=>f!=="content")) && <p className="core-conflicts-warning">{t("This saves text only. Keep the copy to review its other differences.")}</p>}
        {comparison.hunks.length===0 && <p>{t("The text is identical. You can finish reviewing this copy.")}</p>}
        {comparison.hunks.slice(hunkPage*50,hunkPage*50+50).map((h,j)=>{const i=hunkPage*50+j;return <article className="core-conflicts-hunk" key={i}>
          <div className="core-conflicts-hunk-heading"><h2>{t("Difference {number}",{number:i+1})}</h2><span>{choices[i]?t("Reviewed"):t("Choose a version")}</span></div>
          {h.s>0 && <details className="core-collection-disclosure"><summary>{t("Unchanged context")}</summary><pre>{comparison.current.slice(Math.max(i?comparison.hunks[i-1].e:0,h.s-3),h.s).join("\n")}</pre></details>}
          <div className="core-conflicts-columns"><div><h3>{t("Current note")}</h3><pre>{comparison.current.slice(h.s,h.e).join("\n") || t("No text (deleted)")}</pre></div><div><h3>{t("Saved version")}</h3><pre>{h.ins.join("\n") || t("No text (deleted)")}</pre></div></div>
          <div className="core-conflicts-choices" role="group" aria-label={t("Difference {number}",{number:i+1})}>{(["current","saved","both"] as const).map(choice=><button type="button" key={choice} className={`core-button${choices[i]===choice?" core-button-primary":" core-button-secondary"}`} disabled={busy || stale} aria-pressed={choices[i]===choice} onClick={()=>setChoices(c=>{const next=[...c];next[i]=choice;return next;})}>{choice==="current"?t("Keep current"):choice==="saved"?t("Keep saved version"):t("Keep both")}</button>)}</div>
        </article>;})}
        {comparison.hunks.length>50 && <div className="core-conflicts-pagination"><button type="button" className="core-button core-button-secondary" disabled={!hunkPage} onClick={()=>setHunkPage(p=>p-1)}>{t("Previous")}</button><span>{t("Page {number}",{number:hunkPage+1})}</span><button type="button" className="core-button core-button-secondary" disabled={(hunkPage+1)*50>=comparison.hunks.length} onClick={()=>setHunkPage(p=>p+1)}>{t("Next")}</button></div>}
        {!remaining && <details className="core-collection-disclosure core-conflicts-preview" onToggle={e=>void preview(e.currentTarget)}><summary>{t("Preview result")}</summary><pre>{result}</pre></details>}
      </>}
    </div>
    <footer className="core-conflicts-footer"><span role="status">{busy?t("Loading…"):comparison?t("{count} differences remaining",{count:remaining}):""}</span><button type="button" className="core-button core-button-primary" disabled={!canApply} onClick={()=>void apply()}>{t("Apply resolution")}</button></footer>
    {discard && <div className="core-modal-backdrop"><div className="core-modal" role="dialog" aria-modal="true" aria-label={t("Discard choices?")}><h2>{t("Discard choices?")}</h2><p>{t("Your notes will stay unchanged.")}</p><div className="core-conflicts-choices"><button type="button" className="core-button core-button-secondary" autoFocus onClick={()=>setDiscard(null)}>{t("Keep reviewing")}</button><button type="button" className="core-button core-button-secondary" onClick={()=>{const run=discard;setDiscard(null);setChoices([]);run();}}>{t("Discard choices")}</button></div></div></div>}
  </section>;
}
