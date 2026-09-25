import { defineModule } from "./module.ts";

/** `core.config`: the module registry; settings, entitlements, and custom fields come later. */
export const configModule = defineModule({ id: "core.config", dependsOn: [] });
