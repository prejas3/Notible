/**
 * Print Probe — THROWAWAY spike for the ReportIt design.
 *
 * Question it answers: does `window.print()` in this app's webview produce a
 * usable, MULTI-PAGE "Save as PDF" when a tall document is taken out of every
 * clipping/overflow ancestor (reparented under <body>) and given CSS page
 * breaks — or does it hand back one truncated page?
 *
 * How to read the result:
 *   - The print dialog opens and offers "Save as PDF" (or "Microsoft Print to
 *     PDF")                                                  → good so far
 *   - The saved PDF has ~15+ pages, one "PAGE N" heading near the top of each
 *     forced-break page, the code block not split across a page boundary
 *                                                            → the ReportIt
 *                                                              print approach
 *                                                              works
 *   - One page, content cut off at the first screenful      → reparenting did
 *                                                              not help; the
 *                                                              output mechanism
 *                                                              must change (a
 *                                                              downloadable
 *                                                              .html opened in
 *                                                              a real browser)
 *   - Toggle the dialog's own "Headers and footers" and check if a page
 *     number appears — that is the only page-number path Chromium gives us.
 *
 * Delete this whole folder once the decision is recorded.
 */

const PAGES = 16;

function el(tag, props = {}, kids = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const k of kids) node.append(k);
  return node;
}

function buildDoc() {
  const doc = el("article", { className: "pp-doc" });

  doc.append(el("header", { className: "pp-cover" }, [
    el("h1", { textContent: "Print Probe" }),
    el("p", { textContent: new Date().toLocaleDateString() }),
    el("p", { textContent: "If this cover is on its own page and the sections that follow paginate, the ReportIt reparent-and-print approach holds." }),
  ]));

  const toc = el("nav", { className: "pp-toc" }, [el("h2", { textContent: "Contents" })]);
  const ol = el("ol");
  for (let i = 1; i <= PAGES; i += 1) ol.append(el("li", { textContent: `Section ${i}` }));
  toc.append(ol);
  doc.append(toc);

  const lorem = "The quick brown fox jumps over the lazy dog. ".repeat(40);
  for (let i = 1; i <= PAGES; i += 1) {
    const sec = el("section", { className: "pp-section" });
    sec.append(el("h2", { className: "pp-section-title", textContent: `PAGE ${i}` }));
    sec.append(el("p", { className: "pp-section-type", textContent: "probe section" }));
    for (let p = 0; p < 3; p += 1) sec.append(el("p", { textContent: lorem }));
    if (i % 4 === 0) {
      const pre = el("pre");
      pre.textContent = Array.from({ length: 20 }, (_, n) => `line ${n + 1}  // this code block must not split across a page boundary`).join("\n");
      sec.append(pre);
    }
    doc.append(sec);
    if (i < PAGES) doc.append(el("hr", { className: "pp-rule" }));
  }
  return doc;
}

const styles = `
.pp { color: var(--notible-text); font-size: 13px; }
.pp-bar { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
.pp-bar button { border: 1px solid var(--notible-accent); border-radius: 7px; background: var(--notible-accent); color: var(--notible-on-accent); font: inherit; font-weight: 600; padding: 6px 14px; cursor: pointer; }
.pp-note { margin: 0; color: var(--notible-muted); font-size: 12px; max-width: 70ch; line-height: 1.5; }
.pp-preview { border: 1px solid var(--notible-border); border-radius: 10px; padding: 24px; background: #fff; overflow: auto; max-height: 60vh; }

/* The document — fixed light, serif body, sans headings, like the ReportIt spec. */
.pp-doc { background: #fff; color: #1a1a1a; font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.5; max-width: 210mm; margin: 0 auto; }
.pp-doc h1, .pp-doc h2 { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
.pp-cover { min-height: 60vh; display: flex; flex-direction: column; justify-content: center; }
.pp-cover h1 { font-size: 30pt; margin: 0 0 8px; }
.pp-toc h2 { font-size: 16pt; }
.pp-section-title { font-size: 15pt; margin: 0; }
.pp-section-type { margin: 2px 0 10px; font-size: 8pt; color: #888; text-transform: lowercase; }
.pp-doc pre { background: #f4f4f4; padding: 10px 12px; font: 9pt/1.4 ui-monospace, Consolas, monospace; white-space: pre-wrap; }
.pp-rule { border: 0; border-top: 1px solid #ccc; margin: 22px 0; }

@page { size: A4; margin: 20mm; }
@media print {
  body > *:not(#pp-print-host) { display: none !important; }
  #pp-print-host, #pp-print-host .pp-doc { display: block; }
  .pp-doc { position: static; max-width: none; margin: 0; }
}
.pp-cover, .pp-toc { break-after: page; }
.pp-section-title, .pp-section-type { break-after: avoid; }
.pp-section { break-inside: auto; }
.pp-doc pre { break-inside: avoid; }
`;

export default {
  manifest: {
    id: "dev.printprobe",
    name: "Print Probe (throwaway)",
    version: "0.0.1",
    apiVersion: "1.8",
    description: "THROWAWAY spike — checks whether window.print() in this webview produces a usable multi-page PDF when a tall document is reparented to <body> with CSS page breaks. Not for the market. Delete after the ReportIt print decision.",
    author: "Notible",
    permissions: ["workspace.ui"],
  },

  onload(context) {
    this._disposables = [];
    this._disposables.push(context.views.register({
      id: "probe",
      title: "Print Probe",
      nav: true,
      navIcon: "file-text",
      mount: ({ container }) => {
        const root = el("div", { className: "pp" });
        root.append(el("style", { textContent: styles }));

        const printBtn = el("button", { type: "button", textContent: "Print / Save as PDF" });
        root.append(el("div", { className: "pp-bar" }, [printBtn]));
        root.append(el("p", { className: "pp-note", textContent: "Click Print. In the dialog pick “Save as PDF”, save, and open the file. Check: does it have ~16 pages, one “PAGE N” near the top of each, and code blocks kept whole? Also try the dialog’s own “Headers and footers” for a page number. One truncated page = the reparent approach failed." }));

        const preview = el("div", { className: "pp-preview" });
        const doc = buildDoc();
        preview.append(doc);
        root.append(preview);
        container.append(root);

        // The thing under test: on print, move .pp-doc out of every overflow
        // ancestor to a fresh top-level host under <body>, print, put it back.
        let host = null;
        const restore = () => {
          if (host) {
            preview.append(doc);
            host.remove();
            host = null;
          }
        };
        const onAfterPrint = () => restore();
        window.addEventListener("afterprint", onAfterPrint);
        printBtn.addEventListener("click", () => {
          host = el("div", { id: "pp-print-host" });
          host.append(doc);
          document.body.append(host);
          // A frame so layout settles in the new position before print.
          requestAnimationFrame(() => {
            if (typeof window.print === "function") window.print();
            else { context.ui.notice("window.print() is not available in this host."); restore(); }
          });
        });

        return { dispose: () => { window.removeEventListener("afterprint", onAfterPrint); restore(); root.remove(); } };
      },
    }));
  },

  onunload() {
    for (const d of this._disposables ?? []) d.dispose?.();
    this._disposables = [];
  },
};
