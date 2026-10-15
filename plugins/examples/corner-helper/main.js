/**
 * Corner helper — the smallest use of API 1.22, and the plugin the
 * `nib-corner-helper.cjs` sandbox scenario installs.
 *
 *   - `ui.registerSlot("workspace.corner")` for the floating box
 *   - `help.topics()` / `help.onChange` for what this build knows
 *   - `ui.openHelp` / `ui.openPluginSettings` from a click (a user gesture)
 *   - `ui.renderMarkdown` for Help text, never raw HTML
 *
 * State lives outside `mount`: Core hides the corner (it does not unmount it)
 * on Settings and Help, but a mount can still be rebuilt at any time.
 */
export default {
  manifest: {
    id: "example.corner-helper",
    name: "Corner helper example",
    version: "0.1.0",
    apiVersion: "1.22",
    permissions: ["workspace.ui"],
  },
  onload(context) {
    let clicks = 0;
    context.ui.registerSlot("workspace.corner", {
      id: "helper",
      mount: ({ container }) => {
        const box = document.createElement("div");
        box.className = "corner-helper-example";
        box.style.cssText = "display:grid;gap:6px;padding:10px;border:1px solid var(--notible-border);border-radius:10px;background:var(--notible-surface);color:var(--notible-text);font-size:12px;width:240px";
        const status = document.createElement("p");
        status.style.margin = "0";
        const answer = document.createElement("div");
        answer.className = "corner-helper-answer";
        const button = (label, onClick) => {
          const element = document.createElement("button");
          element.type = "button";
          element.textContent = label;
          element.addEventListener("click", onClick);
          box.append(element);
          return element;
        };
        const render = () => {
          const topics = context.help.topics();
          box.dataset.topics = String(topics.length);
          box.dataset.planning = topics.find((topic) => topic.id === "plugin:notible.planning")?.state ?? "unknown";
          box.dataset.clicks = String(clicks);
          status.textContent = `I know ${topics.length} topics.`;
        };
        box.append(status, answer);
        button("Count", () => { clicks += 1; render(); });
        button("Explain writing", () => {
          const writing = context.help.topics().find((topic) => topic.id === "core:writing-notes");
          answer.innerHTML = context.ui.renderMarkdown(writing?.sections[0]?.text ?? "I don't have information about that yet.");
        });
        button("Open Help", () => { void context.ui.openHelp("writing-notes"); });
        button("Turn on Planning", () => { void context.ui.openPluginSettings("notible.planning"); });
        // Images never come back from renderMarkdown (no fake banners).
        box.dataset.imageDropped = String(!context.ui.renderMarkdown("![x](data:image/png;base64,AAAA)").includes("<img"));
        // Without a user gesture this must be refused.
        context.ui.openHelp("writing-notes").then(
          () => { box.dataset.noGesture = "allowed"; },
          () => { box.dataset.noGesture = "refused"; },
        );
        const subscription = context.help.onChange(render);
        render();
        container.append(box);
        return { dispose: () => subscription.dispose() };
      },
    });
  },
};
