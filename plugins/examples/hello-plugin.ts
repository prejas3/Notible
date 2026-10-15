import type { NotiblePlugin } from "../../packages/plugin-api/src/index.ts";

/**
 * Minimal fixture for the developer ExtensionHost.
 * It deliberately uses only the current v0 registration surface.
 */
export const helloPlugin: NotiblePlugin = {
  manifest: {
    id: "example.hello",
    name: "Hello plugin",
    version: "0.1.0",
    apiVersion: "0.1",
    description: "Fixture used to verify plugin lifecycle and cleanup.",
    permissions: ["workspace.ui"],
  },
  onload(context) {
    context.commands.register({
      id: "say-hello",
      name: "Say hello",
      execute: () => "Hello from a Notible plugin",
    });
    context.views.register({
      id: "hello-view",
      title: "Hello",
      render: { kind: "fixture", text: "Hello from a Notible plugin" },
    });
    context.ui.registerSlot("editor.toolbar", {
      id: "hello-action",
      render: { kind: "fixture-action", label: "Hello" },
    });
  },
};
