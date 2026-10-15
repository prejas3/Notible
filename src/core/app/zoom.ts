/**
 * Interface size (R5 L7): Ctrl+= / Ctrl+- / Ctrl+0 and Settings → Appearance. Real webview zoom
 * (Tauri setZoom), not CSS zoom, so pointer maths on boards and canvases stays right. Kept per
 * device in localStorage: a laptop and a 4K screen want different sizes.
 */
export const ZOOM_KEY = "notible-ui-zoom";
export const ZOOM_STEPS = [0.8, 0.9, 1, 1.1, 1.25, 1.5] as const;

export function readZoom(): number {
  try {
    const value = Number(localStorage.getItem(ZOOM_KEY));
    return ZOOM_STEPS.includes(value as (typeof ZOOM_STEPS)[number]) ? value : 1;
  } catch {
    return 1;
  }
}

/** The next step up (+1) or down (-1); 0 resets to 100 %. */
export function stepZoom(current: number, direction: -1 | 0 | 1): number {
  if (direction === 0) return 1;
  const index = ZOOM_STEPS.findIndex((step) => step >= current - 0.001);
  const at = index === -1 ? ZOOM_STEPS.length - 1 : index;
  return ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, at + direction))];
}

export async function applyZoom(level: number): Promise<void> {
  try { localStorage.setItem(ZOOM_KEY, String(level)); } catch { /* still applied for this session */ }
  try {
    const { getCurrentWebview } = await import("@tauri-apps/api/webview");
    await getCurrentWebview().setZoom(level);
  } catch {
    // Not in the desktop shell (test host, browser): nothing to zoom.
  }
}
