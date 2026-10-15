/** Print-to-PDF for a note. There is no PDF library here and no file API:
 * the note is rendered with the editor's own Markdown renderer into a hidden
 * iframe and handed to the browser's print dialog, whose "Save as PDF"
 * destination writes the file. That keeps pasted screenshots (stored as
 * data: URIs inside the Markdown) in the output — the thing a round-trip
 * through an online .md converter always loses. */

export type CorePrintOptions = {
  /** Body text size in points. Print units, not screen units. */
  fontPt: number;
  /** Page margin in millimetres, applied via @page. */
  marginMm: number;
  /** Repeat the note title as a heading on the first page. */
  title: boolean;
  /** Print the export date under the title. */
  date: boolean;
  /** Force every image onto its own line at full width. */
  wideImages: boolean;
};

export const CORE_PRINT_DEFAULTS: CorePrintOptions = {
  fontPt: 11,
  marginMm: 18,
  title: true,
  date: false,
  wideImages: false,
};

const clamp = (value: number, min: number, max: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;

export function normalizeCorePrintOptions(raw: unknown): CorePrintOptions {
  const value = (raw && typeof raw === "object" ? raw : {}) as Partial<CorePrintOptions>;
  return {
    fontPt: clamp(Number(value.fontPt ?? CORE_PRINT_DEFAULTS.fontPt), 7, 20),
    marginMm: clamp(Number(value.marginMm ?? CORE_PRINT_DEFAULTS.marginMm), 0, 40),
    title: value.title ?? CORE_PRINT_DEFAULTS.title,
    date: value.date ?? CORE_PRINT_DEFAULTS.date,
    wideImages: value.wideImages ?? CORE_PRINT_DEFAULTS.wideImages,
  };
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"]/gu, (char) => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;"));

/** The printed document is standalone — it does not inherit core-only.css,
 * so everything renderCoreMarkdown can emit gets a rule here. */
export function printableDocument(title: string, bodyHtml: string, options: CorePrintOptions, now = new Date()) {
  const heading = options.title ? `<h1 class="core-print-title">${escapeHtml(title || "Untitled")}</h1>` : "";
  const stamp = options.date ? `<p class="core-print-date">${escapeHtml(now.toLocaleDateString())}</p>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title || "Untitled")}</title><style>
@page { margin: ${options.marginMm}mm; }
body { font: ${options.fontPt}pt/1.5 Georgia, "Times New Roman", serif; color: #111; margin: 0; }
h1, h2, h3 { line-height: 1.25; page-break-after: avoid; }
h1 { font-size: ${(options.fontPt * 1.9).toFixed(1)}pt; }
h2 { font-size: ${(options.fontPt * 1.5).toFixed(1)}pt; }
h3 { font-size: ${(options.fontPt * 1.2).toFixed(1)}pt; }
.core-print-title { margin: 0 0 0.2em; }
.core-print-date { margin: 0 0 1.5em; color: #666; font-size: ${(options.fontPt * 0.85).toFixed(1)}pt; }
p, li { orphans: 2; widows: 2; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 2px solid #bbb; color: #444; }
hr { border: 0; border-top: 1px solid #ccc; }
img.core-md-image { ${options.wideImages ? "display: block; width: 100%;" : "max-width: 100%;"} height: auto; page-break-inside: avoid; }
table { border-collapse: collapse; width: 100%; page-break-inside: avoid; }
th, td { border: 1px solid #bbb; padding: 0.3em 0.5em; text-align: left; }
pre.core-code-block { font: ${(options.fontPt * 0.9).toFixed(1)}pt/1.4 "Cascadia Mono", Consolas, monospace; background: #f4f4f4; padding: 0.6em 0.8em; white-space: pre-wrap; word-break: break-word; page-break-inside: avoid; }
/* Screen-only chrome the editor injects into its own markup. */
.core-code-toolbar, .core-md-block[data-core-block] strong { display: none; }
a { color: inherit; text-decoration: underline; }
.core-md-fnref { font-size: 0.72em; vertical-align: super; line-height: 0; }
.core-md-fndef { font-size: 0.86em; color: #444; margin: 0 0 0.3em; }
.core-md-fndef .core-md-fnref { font-size: 1em; vertical-align: baseline; line-height: inherit; }
p:not(.core-md-fndef) + .core-md-fndef { margin-top: 1.6em; padding-top: 0.7em; border-top: 1px solid #ccc; }
.core-md-fnlink { text-decoration: underline; word-break: break-all; }
</style></head><body>${heading}${stamp}${bodyHtml}</body></html>`;
}

/** Renders into a detached iframe and prints it. Resolves once the print
 * dialog has been dismissed and the iframe removed. */
export function printDocumentHtml(html: string, doc: Document = document, fileName?: string) {
  return new Promise<void>((resolve) => {
    // Chrome names the saved PDF after the TOP document's title, not the
    // printed iframe's, so every export came out called "Notible Test Host".
    // Borrow the title for the length of the dialog and put it back.
    const hostTitle = doc.title;
    const restore = () => { doc.title = hostTitle; };
    if (fileName) doc.title = fileName;
    const frame = doc.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
      const view = frame.contentWindow;
      // ponytail: fixed settle delay before print() — data: images are already
      // decoded in the parent, so this is only layout. Swap for an
      // img.decode() barrier if a very long note ever prints half-laid-out.
      setTimeout(() => {
        try {
          view?.focus();
          view?.print();
        } finally {
          setTimeout(() => { frame.remove(); restore(); resolve(); }, 500);
        }
      }, 150);
    };
    doc.body.append(frame);
    const inner = frame.contentDocument;
    if (!inner) { frame.remove(); restore(); resolve(); return; }
    inner.open();
    inner.write(html);
    inner.close();
  });
}
