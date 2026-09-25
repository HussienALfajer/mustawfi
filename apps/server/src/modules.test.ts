import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleRegistryError } from "@mustawfi/core-config/server";
import { describe, expect, it } from "vitest";
import { createServerRegistry, serverModules } from "./modules.ts";

const root = fileURLToPath(new URL("../../../", import.meta.url));

/** Every module package in the workspace, with the manifest facts in its `package.json`. */
function workspaceModules(): { id: string; dependsOn: string[] }[] {
  return (["core", "modules"] as const).flatMap((layer) => {
    const layerDir = join(root, layer);
    if (!existsSync(layerDir)) return [];
    return readdirSync(layerDir, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(layerDir, entry.name, "package.json")),
      )
      .map((entry) => {
        const json = JSON.parse(
          readFileSync(join(layerDir, entry.name, "package.json"), "utf8"),
        ) as { mustawfi?: { dependsOn?: string[] } };
        return {
          id: layer === "core" ? `core.${entry.name}` : entry.name,
          dependsOn: [...(json.mustawfi?.dependsOn ?? [])].sort(),
        };
      });
  });
}

describe("server modules", () => {
  it("register every workspace module, each manifest matching its package.json", () => {
    const manifests = serverModules
      .map((m) => ({ id: m.id, dependsOn: [...m.dependsOn].sort() }))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const packages = workspaceModules().sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(manifests).toEqual(packages);
  });

  it("form a registry that starts", () => {
    expect(createServerRegistry().enabled.map((m) => m.id)).toEqual([
      "core.config",
      "core.tenancy",
      "core.audit",
      "core.access",
    ]);
  });

  it("refuse to start with a module disabled that an enabled one depends on", () => {
    expect(() => createServerRegistry(["core.tenancy"])).toThrow(ModuleRegistryError);
  });
});
