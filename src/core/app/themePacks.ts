// Theme packs: the small shared state between Core (which owns the document and
// the package manager) and the Themes screen (a builtin plugin). A tiny external
// store rather than window events, so both sides read one truth and the screen
// re-renders when it changes.
import { useSyncExternalStore } from "react";
import type { ThemeSource } from "./marketSource.ts";

export interface ThemePackInfo {
  /** The package id. */
  id: string;
  version: string;
  name: string;
  mode: "light" | "dark";
  description: string;
  author: string;
}

/** What Core lets the Themes screen do to packages. Registered by Core at start. */
export interface ThemePackHost {
  /** Download and install a theme pack from the catalogue. */
  install(source: ThemeSource): Promise<void>;
  /** Download and install a theme pack from a GitHub repository (owner/name). */
  installFromRepo(repo: string): Promise<void>;
  remove(id: string): Promise<void>;
}

interface State {
  /** True for the first paint after the previous start did not run cleanly with a theme, which was then turned off. */
  recovered: boolean;
  packs: ThemePackInfo[];
  /** The pack in use, or null for the system theme alone. */
  activeId: string | null;
  host: ThemePackHost | null;
}

const ACTIVE_KEY = "notible-theme-pack";

const PENDING_KEY = "notible-theme-pack-pending";

/** The stored pick, unless the last start never got past its first seconds with it: then it is dropped. */
function readActive(): { id: string | null; recovered: boolean } {
  try {
    if (localStorage.getItem(PENDING_KEY)) {
      localStorage.removeItem(PENDING_KEY);
      localStorage.removeItem(ACTIVE_KEY);
      return { id: null, recovered: true };
    }
    return { id: localStorage.getItem(ACTIVE_KEY) || null, recovered: false };
  } catch { return { id: null, recovered: false }; }
}

const initial = readActive();
let state: State = { recovered: initial.recovered, packs: [], activeId: initial.id, host: null };
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };
const update = (next: Partial<State>) => { state = { ...state, ...next }; emit(); };

export function subscribeThemePacks(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const getThemePackState = (): State => state;

export function setThemePacks(packs: ThemePackInfo[]) {
  update({ packs });
}

export function setThemePackHost(host: ThemePackHost | null) {
  update({ host });
}

/** Pick a pack (or null for none). Persisted; Core applies it. */
export function selectThemePack(id: string | null) {
  try { if (id) localStorage.setItem(ACTIVE_KEY, id); else localStorage.removeItem(ACTIVE_KEY); } catch { /* the choice just will not survive a restart */ }
  update({ activeId: id });
}

export function useThemePacks(): State {
  return useSyncExternalStore(subscribeThemePacks, getThemePackState);
}
