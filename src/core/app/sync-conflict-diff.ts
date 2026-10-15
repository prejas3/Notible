// Hive #7: bounded two-way differences. Fences are indivisible, common text
// stays once, and nothing is chosen until the user explicitly selects it.
export type Choice = "current" | "saved" | "both";
export interface Hunk { s: number; e: number; ins: string[] }
export interface Comparison { current: string[]; saved: string[]; hunks: Hunk[] }
const MAX_UNITS = 20_000, MAX_D = 2_000;

function units(content: string): string[] | null {
  if (content.length > 2_000_000) return null;
  if (content === "" || content === "{}") return [];
  try {
    const doc = JSON.parse(content);
    if (doc?.type !== "doc" || Object.keys(doc).length !== 2 || !Array.isArray(doc.content) || doc.content.length > MAX_UNITS) return null;
    const lines: string[] = [];
    for (const p of doc.content) {
      if (p?.type !== "paragraph" || Object.keys(p).some((k) => k !== "type" && k !== "content")) return null;
      const parts = p.content ?? [];
      if (!Array.isArray(parts) || parts.length > 1) return null;
      const t = parts[0];
      if (t && (t.type !== "text" || Object.keys(t).length !== 2 || typeof t.text !== "string" || /[\r\n]/u.test(t.text))) return null;
      lines.push(t?.text ?? "");
    }
    if (lines.length === 1 && lines[0] === "") return [];
    const out: string[] = []; let fence: string[] | null = null;
    for (const line of lines) {
      // Structured tables need cell-level review, outside this flat-body view.
      if (line.trim().startsWith("```notible-table")) return null;
      if (fence) { fence.push(line); if (line.trim() === "```") { out.push(fence.join("\n")); fence = null; } }
      else if (line.trim().startsWith("```")) fence = [line]; else out.push(line);
    }
    return fence ? null : out;
  } catch { return null; }
}

// Myers O(ND), bounded by the Sync A budgets. Trim identical ends first.
export function diff(a: string[], b: string[]): Hunk[] | null {
  if (a.length > MAX_UNITS || b.length > MAX_UNITS) return null;
  let p = 0; while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let q = 0; while (q < a.length-p && q < b.length-p && a[a.length-1-q] === b[b.length-1-q]) q++;
  const A = a.slice(p,a.length-q), B = b.slice(p,b.length-q), n = A.length, m = B.length;
  if (!n || !m) return n+m > MAX_D ? null : n || m ? [{s:p,e:p+n,ins:B}] : [];
  const max = Math.min(n+m,MAX_D), off = max+1, v = new Int32Array(2*off+1), trace: Int32Array[] = [];
  let found = -1;
  for (let d=0; d<=max && found<0; d++) {
    trace.push(v.slice(off-d,off+d+1));
    for (let k=-d; k<=d; k+=2) {
      let x = k===-d || (k!==d && v[off+k-1]<v[off+k+1]) ? v[off+k+1] : v[off+k-1]+1, y=x-k;
      while(x<n && y<m && A[x]===B[y]) {x++;y++;} v[off+k]=x;
      if(x>=n && y>=m) {found=d;break;}
    }
  }
  if(found<0) return null;
  const at=(d:number,k:number)=>trace[d][k+d];
  const ops: {x:number;ins?:string;del?:boolean}[]=[]; let x=n,y=m;
  for(let d=found;d>0;d--) {
    const k=x-y,down=k===-d || (k!==d && at(d,k-1)<at(d,k+1)),pk=down?k+1:k-1,px=at(d,pk),py=px-pk;
    ops.push(down?{x:px,ins:B[py]}:{x:px,del:true});x=px;y=py;
  }
  ops.reverse();const hunks:Hunk[]=[];
  for(const op of ops) {
    let h=hunks[hunks.length-1];if(!h || op.x!==h.e){h={s:op.x,e:op.x,ins:[]};hunks.push(h);}
    if(op.del) h.e++;else h.ins.push(op.ins!);
  }
  return hunks.map(h=>({...h,s:h.s+p,e:h.e+p}));
}
export function compare(current: string, saved: string): Comparison | null {
  const a=units(current),b=units(saved);if(!a || !b) return null;
  const hunks=diff(a,b);return hunks ? {current:a,saved:b,hunks} : null;
}
export function resultText(c: Comparison, choices: (Choice | undefined)[]): string {
  const out:string[]=[];let cursor=0;
  c.hunks.forEach((h,i)=>{
    const choice=choices[i];if(!choice) throw new Error("unreviewed");
    out.push(...c.current.slice(cursor,h.s));
    const mine=c.current.slice(h.s,h.e);
    out.push(...(choice==="current"?mine:choice==="saved"?h.ins:[...mine,...(mine.length && h.ins.length?[""]:[]),...h.ins]));cursor=h.e;
  });return [...out,...c.current.slice(cursor)].join("\n");
}
