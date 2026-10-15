/**
 * Which task statuses a project shows (repair plan D2, 01.10). The Task type
 * keeps all 11 statuses and no data changes; a project created from 0.93.3 on
 * is marked `statusSet: "simple"` and shows four of them. "All statuses" in
 * the view's ⋯ menu switches a project back to the full set. Projects made
 * before have no mark and keep showing all 11.
 */
export const SIMPLE_TASK_STATUSES = ["todo", "in-progress", "blocked", "done"];

/** Props every new project starts with. */
export const NEW_PROJECT_PROPS = { statusSet: "simple" } as const;

export function isSimpleStatusSet(containerProps: Record<string, unknown> | undefined): boolean {
  return containerProps?.statusSet === "simple";
}

/** The statuses to offer for `typeName` inside a container with these props. */
export function shownStatuses(all: string[], containerProps: Record<string, unknown> | undefined, typeName: string): string[] {
  if (typeName !== "task" || !isSimpleStatusSet(containerProps)) return all;
  const simple = SIMPLE_TASK_STATUSES.filter((status) => all.includes(status));
  return simple.length > 0 ? simple : all;
}

/** A status list for a picker: the shown ones, plus the record's own value if it is outside them. */
export function statusChoices(shown: string[], current: string): string[] {
  return current && !shown.some((status) => status.toLowerCase() === current.toLowerCase()) ? [...shown, current] : shown;
}
