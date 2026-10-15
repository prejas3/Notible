// E14B-KEEPALIVE (Hive #2): persistent code-block mounts survive decorate passes.

/** What the note editor hands the code-block decorator so a block can write itself back. */
export type CodeBlockEditorBridge = {
  /** Replace the source of `pre`'s block in the note. False when the block is gone. */
  updateSource(pre: HTMLPreElement, next: string): boolean;
  readOnly: boolean;
};

export type MountKey = { language: string; source: string; render: unknown };

/** A persistent mount is kept only while it is still on screen and nothing about it changed. */
export function keepMount(entry: MountKey & { connected: boolean }, next: MountKey): boolean {
  return entry.connected && entry.language === next.language && entry.source === next.source && entry.render === next.render;
}

/**
 * E14B-WRITE-GUARD: a block may write back only over the source it was drawn
 * from (a hand edit not yet redrawn wins) and never a line that closes its fence.
 */
export function sourceWriteAllowed(current: string, expected: string, next: string): boolean {
  return current === expected && !/^```/m.test(next);
}
