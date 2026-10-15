/**
 * Pomodoro — a worked example of a third-party Notible plugin.
 *
 * Deliberately plain: one ES module, no build step, no dependencies, no
 * framework. Notible serves this file to the webview over the `plugin:`
 * scheme and imports it, so what you write is what runs.
 *
 * It exercises the whole third-party surface that exists today:
 *   - `ui.registerSlot` + `mount` to draw into the sidebar
 *   - `ui.notice` for a Core-owned toast when a phase ends
 *   - `commands.register` for the command palette
 *   - `storage` to remember the session count
 *   - `events.on("theme.changed")` to react to the host
 */

const DEFAULT_WORK_MINUTES = 25;
const DEFAULT_BREAK_MINUTES = 5;

/** Settings are declared, not drawn — Core renders the panel (D17). */
function minutesFor(context, key, fallback) {
  const stored = context.storage.get(key);
  return typeof stored === "number" && stored > 0 ? stored : fallback;
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * One timer, shared by every surface the plugin renders. Keeping the state
 * outside `mount` means the countdown survives the sidebar being re-rendered
 * — a mount can be torn down and rebuilt at any time, so it must not own
 * anything the user would notice losing.
 */
function createTimer(context) {
  const listeners = new Set();
  let phase = "work";
  let remaining = minutesFor(context, "workMinutes", DEFAULT_WORK_MINUTES) * 60;
  let running = false;
  let ticker = null;
  let completed = context.storage.get("completed") ?? 0;

  function notify() {
    for (const listener of listeners) listener();
  }

  function stopTicker() {
    if (ticker !== null) {
      clearInterval(ticker);
      ticker = null;
    }
  }

  function switchPhase() {
    if (phase === "work") {
      completed += 1;
      context.storage.set("completed", completed);
      phase = "break";
      const breakMinutes = minutesFor(context, "breakMinutes", DEFAULT_BREAK_MINUTES);
      remaining = breakMinutes * 60;
      if (context.storage.get("notify") !== false) {
        context.ui.notice(`Pomodoro ${completed} done — take ${breakMinutes} minutes.`);
      }
    } else {
      phase = "work";
      remaining = minutesFor(context, "workMinutes", DEFAULT_WORK_MINUTES) * 60;
      if (context.storage.get("notify") !== false) {
        context.ui.notice("Break over — back to it.");
      }
    }
    // Stop at the boundary rather than rolling straight into the next phase:
    // a timer that starts a break without being asked is a timer people turn
    // off.
    running = false;
    stopTicker();
    notify();
  }

  function tick() {
    remaining -= 1;
    if (remaining <= 0) switchPhase();
    else notify();
  }

  return {
    get state() {
      return { phase, remaining, running, completed };
    },
    toggle() {
      running = !running;
      stopTicker();
      if (running) ticker = setInterval(tick, 1000);
      notify();
    },
    reset() {
      running = false;
      stopTicker();
      remaining = (phase === "work"
        ? minutesFor(context, "workMinutes", DEFAULT_WORK_MINUTES)
        : minutesFor(context, "breakMinutes", DEFAULT_BREAK_MINUTES)) * 60;
      notify();
    },
    skip() {
      switchPhase();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() {
      stopTicker();
      listeners.clear();
    },
  };
}

function renderInto(container, timer) {
  container.replaceChildren();

  const root = document.createElement("div");
  // Inline styles rather than a stylesheet: `styles[]` is declared in the
  // manifest format but Core does not inject it yet. Colours come from the
  // host's tokens so the panel follows Paper and Night without asking.
  Object.assign(root.style, {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    margin: "8px 12px",
    padding: "12px",
    border: "1px solid var(--notible-border)",
    borderRadius: "10px",
    background: "var(--notible-surface)",
    color: "var(--notible-text)",
  });

  const heading = document.createElement("div");
  Object.assign(heading.style, {
    display: "flex",
    alignItems: "baseline",
    justifyContent: "space-between",
    fontSize: "11px",
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    opacity: "0.65",
  });
  const phaseLabel = document.createElement("span");
  const countLabel = document.createElement("span");
  heading.append(phaseLabel, countLabel);

  const clock = document.createElement("strong");
  Object.assign(clock.style, {
    fontSize: "28px",
    fontVariantNumeric: "tabular-nums",
    lineHeight: "1.1",
  });

  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "flex", gap: "6px" });

  function button(label, onClick) {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    Object.assign(element.style, {
      flex: "1",
      padding: "6px 8px",
      border: "1px solid var(--notible-border)",
      borderRadius: "7px",
      background: "transparent",
      color: "inherit",
      font: "inherit",
      fontSize: "12px",
      cursor: "pointer",
    });
    element.addEventListener("click", onClick);
    return element;
  }

  const toggleButton = button("Start", () => timer.toggle());
  actions.append(
    toggleButton,
    button("Reset", () => timer.reset()),
    button("Skip", () => timer.skip()),
  );

  root.append(heading, clock, actions);
  container.append(root);

  function paint() {
    const { phase, remaining, running, completed } = timer.state;
    phaseLabel.textContent = phase === "work" ? "Focus" : "Break";
    countLabel.textContent = completed === 1 ? "1 done" : `${completed} done`;
    clock.textContent = formatClock(remaining);
    toggleButton.textContent = running ? "Pause" : "Start";
  }

  paint();
  return paint;
}

export default {
  manifest: {
    id: "example.pomodoro",
    name: "Pomodoro",
    version: "0.1.0",
    apiVersion: "0.1",
    description: "A focus timer in the sidebar. 25 minutes of work, 5 minutes of break, and a notice when each one ends.",
    author: "Notible example",
    permissions: ["workspace.ui"],
  },

  onload(context) {
    const timer = createTimer(context);
    this._timer = timer;

    context.ui.registerSlot("workspace.sidebar", {
      id: "timer",
      mount({ container }) {
        const paint = renderInto(container, timer);
        const unsubscribe = timer.subscribe(paint);
        // Returning a disposable is the contract: the host calls it when the
        // surface goes away, and anything not cleaned up here leaks for the
        // lifetime of the app.
        return { dispose: unsubscribe };
      },
    });

    context.commands.register({
      id: "toggle",
      name: "Pomodoro: start or pause",
      hotkey: "Mod+Shift+P",
      execute: () => {
        timer.toggle();
        return timer.state;
      },
    });

    context.commands.register({
      id: "status",
      name: "Pomodoro: status",
      execute: () => timer.state,
    });

    // Declared, not drawn: Core renders this natively, so it matches the rest
    // of Settings and the plugin ships no UI code for it. Values land in this
    // plugin's own storage under each field's `key`.
    context.settings.register({
      id: "settings",
      title: "Pomodoro",
      schema: {
        sections: [
          {
            title: "Durations",
            description: "Applied when the next phase starts.",
            fields: [
              { kind: "number", key: "workMinutes", label: "Focus minutes", default: DEFAULT_WORK_MINUTES, min: 1, max: 180 },
              { kind: "number", key: "breakMinutes", label: "Break minutes", default: DEFAULT_BREAK_MINUTES, min: 1, max: 60 },
            ],
          },
          {
            fields: [
              { kind: "toggle", key: "notify", label: "Show a notice when a phase ends", default: true },
              { kind: "hotkey", key: "toggleHotkey", label: "Start or pause", commandId: "toggle" },
            ],
          },
        ],
      },
    });
  },

  onunload() {
    this._timer?.dispose();
    this._timer = null;
  },
};
