import type { HelpTopic, HelpTopicSection } from "../../../packages/plugin-api/src/index.ts";
import { splitSections } from "../../help/parse.ts";

/** A Core Help page, as the shell hands it to the host (API 1.22). */
export interface KnowledgePage {
  id: string;
  title: string;
  keywords: string;
  body: string;
  /** Front-matter `plugin:` — the page is about this plugin and follows its state. */
  plugin?: string;
}

/** A plugin the shell knows about, enabled or not. Public text only. */
export interface KnowledgePlugin {
  id: string;
  name: string;
  description: string;
  guide?: string;
}

export type PluginState = HelpTopic["state"];

/** Split Markdown at headings; the intro becomes a section titled `title`. */
function sectionsOf(title: string, keywords: string, body: string): HelpTopicSection[] {
  return splitSections({ id: "", title, keywords, body })
    .map((section) => ({ heading: section.heading, slug: section.slug, text: section.text.trim() }))
    .filter((section) => section.text.length > 0);
}

/** The first paragraph that is prose, not a picture or a heading. */
function firstParagraph(body: string): string {
  for (const block of body.split(/\r?\n\s*\r?\n/u)) {
    const text = block.trim();
    if (text && !text.startsWith("#") && !text.startsWith("![") && !text.startsWith("```")) return text;
  }
  return "";
}

/**
 * Everything a helper may know, from what this build has (API 1.22). Pure, so
 * a Node check can drive it. A topic of a plugin that is not enabled keeps its
 * summary and loses its text: "turn it on" is an answer, a tutorial for a
 * feature the user cannot reach is not.
 */
export function buildHelpTopics(pages: KnowledgePage[], plugins: KnowledgePlugin[], stateOf: (pluginId: string) => PluginState): HelpTopic[] {
  const topics: HelpTopic[] = [];
  for (const page of pages) {
    const state = page.plugin ? stateOf(page.plugin) : "enabled";
    topics.push({
      id: `core:${page.id}`,
      title: page.title,
      source: "core",
      ...(page.plugin ? { pluginId: page.plugin } : {}),
      state,
      summary: firstParagraph(page.body),
      keywords: page.keywords,
      sections: state === "enabled" ? sectionsOf(page.title, page.keywords, page.body) : [],
      helpPageId: page.id,
    });
  }
  const seen = new Set<string>();
  for (const plugin of plugins) {
    if (seen.has(plugin.id)) continue;
    seen.add(plugin.id);
    const state = stateOf(plugin.id);
    topics.push({
      id: `plugin:${plugin.id}`,
      title: plugin.name,
      source: "plugin",
      pluginId: plugin.id,
      state,
      summary: plugin.description,
      keywords: "",
      sections: state === "enabled" && plugin.guide ? sectionsOf(plugin.name, "", plugin.guide) : [],
    });
  }
  return topics;
}
