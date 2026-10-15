// MCP-CLEANUP (Hive #22): wait until the open note is fully saved, or fail.
// Approving an AI cleanup compares each note with the version the AI saw; an
// unsaved draft would slip past that check, so approval must not go ahead
// while one exists. Unlike flushPendingSave (used on quit), this never
// gives up quietly: a failed save or one that does not settle throws.

export interface DraftState {
  /** A save is running or queued. */
  busy(): boolean;
  /** The editor holds text that is not saved yet. */
  dirty(): boolean;
  /** Save now; false when the save failed. */
  save(): Promise<boolean>;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function settleDrafts(state: DraftState, failure: string, attempts = 100, wait: (ms: number) => Promise<unknown> = sleep): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (state.busy()) { await wait(50); continue; }
    if (!state.dirty()) return;
    if (!await state.save()) throw new Error(failure);
    // React clears the dirty flag on the next render.
    await wait(50);
  }
  throw new Error(failure);
}
