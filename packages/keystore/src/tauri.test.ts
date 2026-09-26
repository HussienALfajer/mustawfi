import { describe, expect, it } from "vitest";
import { type SecureStoreRequest, secureStoreOver } from "./tauri.ts";

describe("the secure_store protocol", () => {
  it("sends the requests the native keystore reads, and reads its answers", async () => {
    const sent: SecureStoreRequest[] = [];
    const held = new Map<string, string>();
    const store = secureStoreOver((request) => {
      sent.push(request);
      if (request.kind === "set") held.set(request.name, request.value);
      if (request.kind === "delete") held.delete(request.name);
      return Promise.resolve(request.kind === "get" ? (held.get(request.name) ?? null) : null);
    });
    await store.set("deviceCredential", "secret");
    expect(await store.get("deviceCredential")).toBe("secret");
    await store.delete("deviceCredential");
    expect(await store.get("deviceCredential")).toBeUndefined();
    // The shapes `packages/keystore/native` parses (its protocol test reads the same JSON).
    expect(sent).toEqual([
      { kind: "set", name: "deviceCredential", value: "secret" },
      { kind: "get", name: "deviceCredential" },
      { kind: "delete", name: "deviceCredential" },
      { kind: "get", name: "deviceCredential" },
    ]);
  });
});
