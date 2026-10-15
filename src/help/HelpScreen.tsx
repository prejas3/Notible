import { useEffect, useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { renderCoreMarkdown } from "../core/app/CoreMarkdownEditor.tsx";
import { tCore } from "../core/app/core-i18n.ts";
import { HELP_CHAPTERS, HELP_ORDER } from "./index.ts";
import { HELP_PAGES } from "./pages.ts";
import { renderHelpPage } from "./render.ts";
import "./help.css";

export function HelpScreen({ target, onNavigate, onOpenSettingsPlugins }: {
  target: { id: string; slug?: string };
  onNavigate: (id: string, slug?: string) => void;
  onOpenSettingsPlugins: () => void;
}) {
  const page = HELP_PAGES.get(target.id) ?? HELP_PAGES.get(HELP_ORDER[0]);
  const html = useMemo(() => (page ? renderHelpPage(page.body, renderCoreMarkdown) : ""), [page]);
  // React 19 compares dangerouslySetInnerHTML by object identity: a fresh
  // { __html } each render rewrote the page on every parent re-render, wiping
  // the heading flash and cutting the scroll-to-heading short.
  const inner = useMemo(() => ({ __html: html }), [html]);
  const articleRef = useRef<HTMLElement | null>(null);
  // Below 1180 px the contents are a button, so the article gets the width (V-SCREENS-01).
  const [contentsOpen, setContentsOpen] = useState(false);
  useEffect(() => { setContentsOpen(false); }, [target.id]);
  // The open contents float over the article: Escape or a click outside closes them.
  useEffect(() => {
    if (!contentsOpen) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setContentsOpen(false); } };
    const onDown = (event: PointerEvent) => { if (!(event.target as Element).closest?.(".core-help-toc, .core-help-contents-toggle")) setContentsOpen(false); };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => { window.removeEventListener("keydown", onKey, true); document.removeEventListener("pointerdown", onDown, true); };
  }, [contentsOpen]);
  const at = page ? HELP_ORDER.indexOf(page.id) : -1;
  const previous = at > 0 ? HELP_PAGES.get(HELP_ORDER[at - 1]) : undefined;
  const next = at >= 0 && at < HELP_ORDER.length - 1 ? HELP_PAGES.get(HELP_ORDER[at + 1]) : undefined;

  // Scroll to the heading a link or search hit asked for, and flash it.
  useEffect(() => {
    const article = articleRef.current;
    if (!article) return;
    // A new page starts at the top of the main area, topbar (Back) included.
    if (!target.slug) { article.closest(".core-main")?.scrollTo({ top: 0 }); return; }
    const heading = article.querySelector<HTMLElement>(`#${CSS.escape(target.slug)}`);
    if (!heading) return;
    heading.scrollIntoView({ block: "start", behavior: "smooth" });
    heading.classList.add("core-help-flash");
    const timer = window.setTimeout(() => heading.classList.remove("core-help-flash"), 1400);
    return () => window.clearTimeout(timer);
  }, [target.id, target.slug, html]);

  // Screenshots and clips follow the app theme: under Midnight use `<name>.dark.webp`/`.dark.webm`
  // when help-media made one, and fall back to the light file when not.
  useEffect(() => {
    if (!document.documentElement.classList.contains("core-night")) return;
    for (const image of articleRef.current?.querySelectorAll<HTMLImageElement>('img[src^="help/"][src$=".webp"]') ?? []) {
      const light = image.getAttribute("src")!;
      image.addEventListener("error", () => { image.src = light; }, { once: true });
      image.src = light.replace(/\.webp$/u, ".dark.webp");
    }
    for (const video of articleRef.current?.querySelectorAll<HTMLVideoElement>('video[src^="help/"][src$=".webm"]') ?? []) {
      const light = video.getAttribute("src")!;
      video.addEventListener("error", () => { video.src = light; }, { once: true });
      video.src = light.replace(/\.webm$/u, ".dark.webm");
    }
  }, [html]);

  if (!page) return null;
  return (
    <section className={`core-help core-view-in${contentsOpen ? " is-contents-open" : ""}`}>
      <button type="button" className="core-help-contents-toggle" aria-expanded={contentsOpen} onClick={() => setContentsOpen((current) => !current)}>{contentsOpen ? "×" : "☰"} Contents</button>
      <nav className="core-help-toc" aria-label="Help contents">
        {/* A one-page chapter shows only its page: "Writing notes > Writing
            notes" repeated every group name as its only child (CE75). */}
        {HELP_CHAPTERS.map((chapter) => (
          <div key={chapter.title} className="core-help-chapter">
            {chapter.pages.length > 1 && <p className="core-help-chapter-title">{chapter.title}</p>}
            {chapter.pages.map((id) => (
              <button key={id} type="button" className={id === page.id ? "is-active" : ""} aria-current={id === page.id ? "page" : undefined} onClick={() => onNavigate(id)}>
                {HELP_PAGES.get(id)?.title ?? id}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <article
        ref={articleRef}
        className="core-help-page"
        onClick={(event) => {
          const element = event.target as HTMLElement;
          const video = element.closest<HTMLVideoElement>("video.core-help-video");
          if (video) { if (video.paused) void video.play(); else video.pause(); return; }
          const copy = element.closest<HTMLButtonElement>(".core-code-copy");
          if (copy) {
            void navigator.clipboard.writeText(copy.closest("pre")?.querySelector("code")?.textContent ?? "");
            const original = copy.textContent;
            copy.textContent = tCore("Copied");
            window.setTimeout(() => { copy.textContent = original; }, 1200);
            return;
          }
          const link = element.closest<HTMLAnchorElement>("a.core-help-link");
          if (!link) return;
          event.preventDefault();
          const external = link.dataset.external;
          if (link.dataset.help) onNavigate(link.dataset.help, link.dataset.helpSlug || undefined);
          else if (link.dataset.settings === "plugins") onOpenSettingsPlugins();
          else if (external) void openUrl(external).catch(() => window.open(external, "_blank", "noopener"));
        }}
      >
        <h1 className="core-help-title">{page.title}</h1>
        <div className="core-help-body" dangerouslySetInnerHTML={inner} />
        <footer className="core-help-pager">
          {previous ? <button type="button" onClick={() => onNavigate(previous.id)}>← {previous.title}</button> : <span />}
          {next ? <button type="button" onClick={() => onNavigate(next.id)}>{next.title} →</button> : <span />}
        </footer>
      </article>
    </section>
  );
}
