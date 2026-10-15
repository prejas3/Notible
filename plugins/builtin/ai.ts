import type { PluginContext, PluginObject } from "../../packages/plugin-api/src/index.ts";
import { createBuiltinSurface } from "./scaffold.ts";
import { WORK_MODEL_DEFINITIONS } from "./work-models.ts";

export interface WorkSuggestion { object: PluginObject; score: number; reasons: string[]; }
const WORK_TYPES = new Set(WORK_MODEL_DEFINITIONS.map((definition) => definition.name));
function propsOf(object: PluginObject): Record<string, unknown> { try { const parsed = JSON.parse(object.props) as unknown; return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
export function isWorkType(object: PluginObject): boolean { return WORK_TYPES.has(object.type); }
export function isOpenWork(object: PluginObject): boolean { if (!isWorkType(object)) return false; const status = String(propsOf(object).status ?? ""); return !["done", "closed", "completed", "cancelled", "resolved"].includes(status); }
export function prioritizeWork(objects: PluginObject[]): WorkSuggestion[] { return objects.filter(isOpenWork).map((object) => { const props = propsOf(object); const priority = String(props.priority ?? "none"); const score = priority === "urgent" ? 100 : priority === "high" ? 75 : priority === "medium" ? 50 : 25; const reasons = [priority !== "none" ? `priority:${priority}` : "no priority"]; if (props.due) reasons.push(`due:${String(props.due).slice(0, 10)}`); return { object, score, reasons }; }).sort((left, right) => right.score - left.score); }
export async function prioritizeWorkspace(context: PluginContext) { const objects = await context.data.objects.query({ limit: 5000 }); return { pluginId: context.manifest.id, suggestions: prioritizeWork(objects) }; }

export const aiPlugin = createBuiltinSurface({
  manifest: { id: "notible.ai", name: "AI work desk", version: "0.1.0", apiVersion: "0.1", entry: "index.ts", description: "AI workspace suggestions and provider surfaces.", permissions: ["data.read", "data.write", "workspace.ui", "network"], sync: "settings" },
  capability: "ai",
  commandName: "Prioritize work",
  viewTitle: "AI work desk",
  settingsTitle: "AI settings",
  onCommand: prioritizeWorkspace,
  viewRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
  settingsRender: (context) => ({ kind: "react-loader", loader: () => import("./domain-plugin-ui"), context }),
});
