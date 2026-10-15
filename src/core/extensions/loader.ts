import { loadPluginPackage, isSafePluginPackagePath, type PluginPackageReader } from "./package.ts";
import type { LocalPluginArtifact } from "./manager.ts";

export interface LocalPluginFileReader {
  readText(root: string, path: string): Promise<string>;
  /** See `PluginPackageReader.scriptUrl`. Absent outside a Tauri runtime. */
  scriptUrl?(root: string, path: string): string | null;
}

function childPath(root: string, relativePath: string): string {
  if (!isSafePluginPackagePath(relativePath)) throw new Error(`plugin path must stay inside its directory: ${relativePath}`);
  return `${root.replace(/[\\/]$/, "")}/${relativePath.replaceAll("\\", "/")}`;
}

export async function loadLocalPluginDirectory(
  root: string,
  reader: LocalPluginFileReader,
  trusted: boolean,
): Promise<LocalPluginArtifact> {
  const packageReader: PluginPackageReader = {
    readText: (path) => reader.readText(root, childPath(root, path)),
    scriptUrl: (path) => reader.scriptUrl?.(root, childPath(root, path)) ?? null,
  };
  return loadPluginPackage(packageReader, trusted, "local-file");
}
