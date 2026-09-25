import { describe, expect, it } from "vitest";
import { ConfigError, loadServerConfig } from "./config.ts";

const DATABASE_URL = "postgres://mustawfi_app:secret@localhost:5432/mustawfi";

describe("server configuration", () => {
  it("applies defaults and splits the disabled modules", () => {
    expect(loadServerConfig({ DATABASE_URL, DISABLED_MODULES: " reports , repairs,," })).toEqual({
      DATABASE_URL,
      HOST: "127.0.0.1",
      PORT: 3000,
      DISABLED_MODULES: ["reports", "repairs"],
      CLIENT_ORIGINS: ["http://tauri.localhost"],
    });
  });

  it("reads the native shells' origins", () => {
    expect(
      loadServerConfig({
        DATABASE_URL,
        CLIENT_ORIGINS: "http://tauri.localhost, https://app.example.com",
      }).CLIENT_ORIGINS,
    ).toEqual(["http://tauri.localhost", "https://app.example.com"]);
  });

  it.each([
    ["no database", {}],
    ["a database URL that is not PostgreSQL", { DATABASE_URL: "mysql://localhost/x" }],
    ["a port out of range", { DATABASE_URL, PORT: "70000" }],
    ["a port that is not a number", { DATABASE_URL, PORT: "http" }],
    ["a client origin with a path", { DATABASE_URL, CLIENT_ORIGINS: "http://tauri.localhost/app" }],
    ["a client origin that is not http", { DATABASE_URL, CLIENT_ORIGINS: "tauri://localhost" }],
  ])("refuses to start with %s", (_, env) => {
    expect(() => loadServerConfig(env)).toThrow(ConfigError);
  });
});
