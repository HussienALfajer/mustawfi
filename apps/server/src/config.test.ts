import { describe, expect, it } from "vitest";
import { ConfigError, loadServerConfig } from "./config.ts";

const DATABASE_URL = "postgres://mustawfi_app:secret@localhost:5432/mustawfi";
const TOTP_KEYS_FILE = "/etc/mustawfi/totp.keys";

describe("server configuration", () => {
  it("applies defaults and splits the disabled modules", () => {
    expect(
      loadServerConfig({ DATABASE_URL, TOTP_KEYS_FILE, DISABLED_MODULES: " reports , repairs,," }),
    ).toEqual({
      DATABASE_URL,
      HOST: "127.0.0.1",
      PORT: 3000,
      DISABLED_MODULES: ["reports", "repairs"],
      CLIENT_ORIGINS: ["http://tauri.localhost"],
      TRUST_PROXY: [],
      TOTP_KEYS_FILE,
    });
  });

  it("reads the trusted reverse proxies, as addresses or CIDR ranges", () => {
    expect(
      loadServerConfig({ DATABASE_URL, TOTP_KEYS_FILE, TRUST_PROXY: "127.0.0.1, 10.0.0.0/8,::1" })
        .TRUST_PROXY,
    ).toEqual(["127.0.0.1", "10.0.0.0/8", "::1"]);
  });

  it("reads the native shells' origins", () => {
    expect(
      loadServerConfig({
        DATABASE_URL,
        TOTP_KEYS_FILE,
        CLIENT_ORIGINS: "http://tauri.localhost, https://app.example.com",
      }).CLIENT_ORIGINS,
    ).toEqual(["http://tauri.localhost", "https://app.example.com"]);
  });

  it.each([
    ["no database", { TOTP_KEYS_FILE }],
    ["no TOTP key file", { DATABASE_URL }],
    [
      "a database URL that is not PostgreSQL",
      { DATABASE_URL: "mysql://localhost/x", TOTP_KEYS_FILE },
    ],
    ["a port out of range", { DATABASE_URL, TOTP_KEYS_FILE, PORT: "70000" }],
    ["a port that is not a number", { DATABASE_URL, TOTP_KEYS_FILE, PORT: "http" }],
    [
      "a client origin with a path",
      { DATABASE_URL, TOTP_KEYS_FILE, CLIENT_ORIGINS: "http://tauri.localhost/app" },
    ],
    [
      "a client origin that is not http",
      { DATABASE_URL, TOTP_KEYS_FILE, CLIENT_ORIGINS: "tauri://localhost" },
    ],
    [
      "a trusted proxy that is not an address",
      { DATABASE_URL, TOTP_KEYS_FILE, TRUST_PROXY: "proxy.local" },
    ],
    [
      "a trusted proxy range that is malformed",
      { DATABASE_URL, TOTP_KEYS_FILE, TRUST_PROXY: "10.0.0.0/x" },
    ],
  ])("refuses to start with %s", (_, env) => {
    expect(() => loadServerConfig(env)).toThrow(ConfigError);
  });
});
