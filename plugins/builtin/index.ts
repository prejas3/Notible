import type { NotiblePlugin } from "../../packages/plugin-api/src/index.ts";
import { automationsPlugin } from "./automations.ts";
import { calendarPlugin } from "./calendar.ts";
import { editorExtensionsPlugin } from "./editor-extensions.ts";
import { financePlugin } from "./finance.ts";
import { importExportPlugin } from "./import-export.ts";
import { planningPlugin } from "./planning.ts";
import { propertiesPlugin } from "./properties.ts";
import { queriesPlugin } from "./queries.plugin.ts";
import { searchPlugin } from "./search.ts";
import { themesPlugin } from "./themes.ts";
import { typewriterPlugin } from "./typewriter.ts";
import { viewsPlugin } from "./views.ts";
import { whiteboardPlugin } from "./whiteboard.ts";
import { workModelsPlugin } from "./work-models.ts";

/** Product-bundle registry. Core can be built without importing this module. */
export const BUILTIN_PLUGINS: NotiblePlugin[] = [
  propertiesPlugin,
  workModelsPlugin,
  viewsPlugin,
  planningPlugin,
  automationsPlugin,
  financePlugin,
  calendarPlugin,
  editorExtensionsPlugin,
  queriesPlugin,
  whiteboardPlugin,
  searchPlugin,
  importExportPlugin,
  themesPlugin,
  typewriterPlugin,
];

export const BUILTIN_PLUGIN_IDS = BUILTIN_PLUGINS.map((plugin) => plugin.manifest.id);
