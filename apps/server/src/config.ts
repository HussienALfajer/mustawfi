import { isIP } from "node:net";
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

const originList = z
  .string()
  .default("http://tauri.localhost")
  .transform((value) =>
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin !== ""),
  )
  .pipe(
    z.array(
      z.url({ protocol: /^https?$/ }).refine((url) => new URL(url).origin === url, "not an origin"),
    ),
  );

const proxyList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ""),
  )
  .pipe(
    z.array(
      z
        .string()
        .refine(
          (entry) =>
            /^[0-9a-f:.]+(\/\d{1,3})?$/i.test(entry) && isIP(entry.split("/")[0] ?? "") !== 0,
          "not an address or CIDR range",
        ),
    ),
  );

/** The server's environment (ADR-0014): validated at startup, or the process refuses to start. */
export const serverEnvSchema = z.object({
  /** `mustawfi_app` — never the owner or a superuser; `openTenantDatabase` checks. */
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  /** Comma-separated module ids switched off for this deployment. */
  DISABLED_MODULES: moduleList,
  /**
   * Comma-separated origins of native shells allowed to call the API (CORS, bearer only); the
   * Windows app's by default.
   */
  CLIENT_ORIGINS: originList,
  /**
   * Comma-separated addresses or CIDR ranges of the reverse proxies in front of the server,
   * whose `X-Forwarded-For` is trusted for the client's address; none by default. Sign-in rate
   * limiting counts per source address (`core-foundation` rule 21): behind a proxy that is not
   * listed, every client would share the proxy's address.
   */
  TRUST_PROXY: proxyList,
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
