import { z } from "zod";

const moduleList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== ""),
  );

/** The server's environment (ADR-0014): validated at startup, or the process refuses to start. */
export const serverEnvSchema = z.object({
  /** `mustawfi_app` — never the owner or a superuser; `openTenantDatabase` checks. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Comma-separated module ids switched off for this deployment. */
  DISABLED_MODULES: moduleList,
});

export type ServerConfig = z.infer<typeof serverEnvSchema>;

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadServerConfig(env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const parsed = serverEnvSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`invalid server configuration:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
