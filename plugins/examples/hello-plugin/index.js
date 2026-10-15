export default {
  manifest: {
    id: "example.hello",
    name: "Hello plugin",
    version: "0.1.0",
    apiVersion: "1.0",
    description: "Local directory plugin fixture.",
    entry: "index.js",
    permissions: ["workspace.ui"],
  },
  onload(context) {
    context.commands.register({
      id: "say-hello-local",
      name: "Say hello (local)",
      execute: () => "Hello from a local Notible plugin",
    });
  },
};
