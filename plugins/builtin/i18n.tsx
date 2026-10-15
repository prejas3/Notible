import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { PluginContext } from "../../packages/plugin-api/src/index.ts";

/**
 * `context.i18n.t` for the React builtins, without threading `context` through
 * every subcomponent.
 *
 * Most translatable strings in these files are `aria-label`s on small
 * subcomponents — a condition row, a filter chip — that never needed the
 * plugin context for anything else. Passing it to them purely to translate a
 * label would be a worse trade than one React context.
 *
 * The default is identity, so a component rendered outside a provider shows
 * English rather than blanks. That matters: these are accessibility labels,
 * and a missing one is worse than an untranslated one.
 */
export type Translate = (key: string, values?: Record<string, string | number>) => string;

const identity: Translate = (key, values) =>
  values ? key.replace(/\{(\w+)\}/g, (whole, name: string) => String(values[name] ?? whole)) : key;

const TranslateContext = createContext<Translate>(identity);

export function PluginI18nProvider({ context, children }: { context: PluginContext; children: ReactNode }) {
  // Each builtin mounts its own React root, separate from the host's — a
  // language change in Settings dispatches "notible:preferences" for the
  // host's own useCoreI18n listeners, but nothing tells *this* root to
  // re-render, so already-mounted panels kept showing whatever language was
  // active when they first mounted. Listening here and bumping state forces
  // this context's value identity to change, which re-renders every useT()
  // consumer in the tree — `context.i18n.t` itself already reads the current
  // language on every call, so no other plumbing is needed.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const onPreferencesChanged = () => setTick((value) => value + 1);
    window.addEventListener("notible:preferences", onPreferencesChanged);
    return () => window.removeEventListener("notible:preferences", onPreferencesChanged);
  }, []);
  const translate = useMemo<Translate>(() => (key, values) => context.i18n.t(key, values), [context, tick]);
  return <TranslateContext.Provider value={translate}>{children}</TranslateContext.Provider>;
}

/** I18N (Hive #28): marks a label that is translated later through `t(label)`,
 *  so `npm run locale:extract` sees it. Returns the key unchanged. */
export const tr = (key: string) => key;

export function useT(): Translate {
  return useContext(TranslateContext);
}
