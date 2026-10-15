import { convertFileSrc } from "@tauri-apps/api/core";
import { isDevMockActive } from "../data/dev-mock-invoke.ts";
import { mediaDirectory } from "../data/core-data-api.ts";

/**
 * Stored notes reference a pasted image by filename alone —
 * `media/<uuid>.<ext>` — and this module is the only place that turns that
 * into something a browser can load, and back.
 *
 * Both directions are required and neither works without the other. This
 * editor keeps the DOM as its source of truth: it renders Markdown into
 * HTML, and reads the same HTML back to produce the Markdown it saves. If
 * rendering expanded the reference to an absolute path and nothing collapsed
 * it again, the first keystroke in a note would save that machine's path back
 * into the database — quietly undoing the migration that put the stable form
 * there, and breaking the note on every other machine again.
 */

/** `<uuid-v4>.<known extension>`, and nothing else. */
const MEDIA_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|jpeg|gif|webp|svg|bmp)$/;
const MEDIA_PREFIX = "media/";

/** Filled once at startup; until then references render as-is. */
let mediaDirectoryPath: string | null = null;

/** Fires once, when the directory is known and stored references can expand. */
export const MEDIA_READY_EVENT = "notible:media-directory-ready";

/** Learn where this installation keeps pasted images. Safe to call twice. */
export async function primeMediaDirectory(): Promise<void> {
  if (mediaDirectoryPath !== null) return;
  try {
    mediaDirectoryPath = await mediaDirectory();
  } catch {
    // A browser harness with no backend. References stay in stored form,
    // which renders as a broken image — correct, and not a crash.
    mediaDirectoryPath = "";
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MEDIA_READY_EVENT));
}

/** Has the lookup finished? Renders before it does leave references as-is. */
export function mediaDirectoryKnown(): boolean {
  return mediaDirectoryPath !== null;
}

// Started at import rather than from a component: the first note can be on
// screen within a frame of the app opening, and an image that renders broken
// and only fixes itself on the next keystroke is worse than a short wait.
void primeMediaDirectory();

/** Is this a stored media reference rather than some other kind of URL? */
export function isMediaReference(value: string): boolean {
  return value.startsWith(MEDIA_PREFIX) && MEDIA_FILE.test(value.slice(MEDIA_PREFIX.length));
}

/**
 * Stored reference → a URL the WebView can load.
 *
 * Only exact `media/<uuid>.<ext>` expands. Note content arrives from other
 * machines, so a reference that does not match that shape must never be
 * turned into a path: `assetProtocol.scope` would catch a traversal today,
 * but relying on someone else's guard for our own input is how the last
 * escape happened.
 */
export function expandMediaReference(value: string): string {
  if (!isMediaReference(value) || !mediaDirectoryPath) return value;
  const path = `${mediaDirectoryPath.replaceAll("\\", "/")}/${value.slice(MEDIA_PREFIX.length)}`;
  return isDevMockActive() ? path : convertFileSrc(path);
}

/**
 * A URL that came back out of the DOM → the stored reference.
 *
 * The inverse of `expandMediaReference`, plus the older shapes still sitting
 * in notes that migration 027 has not reached (a note edited on a machine
 * running an older build, or content pasted from one).
 */
export function collapseMediaReference(value: string): string {
  if (isMediaReference(value)) return value;
  // Decode first, THEN normalise separators: an asset URL carries its
  // backslashes percent-encoded, so doing it the other way round leaves
  // `%5C` in place and the filename is never found.
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  decoded = decoded.replaceAll("\\", "/");
  const at = decoded.lastIndexOf("/");
  if (at < 0) return value;
  const name = decoded.slice(at + 1);
  if (!MEDIA_FILE.test(name)) return value;
  // Ours only: an asset URL, or a path whose last directory is `media`.
  // `https://cdn.example.com/media/<uuid>.png` is someone else's image and
  // collapsing it would point the note at a local file that does not exist.
  const lower = decoded.toLowerCase();
  const asset = lower.startsWith("asset://") || lower.includes("//asset.localhost/");
  const ownDirectory = decoded.slice(0, at).toLowerCase().endsWith("/media");
  const remote = /^[a-z][a-z0-9+.-]*:\/\//u.test(lower) && !asset;
  if (remote || !(asset || ownDirectory)) return value;
  return `${MEDIA_PREFIX}${name}`;
}
