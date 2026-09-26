import { type ChildProcessWithoutNullStreams, execFile, spawn } from "node:child_process";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import type { NativeRequest, NativeResponse, NativeTransport } from "./native.ts";

/**
 * The real Rust core (`packages/local-db/native`) for tests, served over stdin/stdout by its
 * `local-db-stdio` host — the same `Session::handle` the Windows shell exposes as its `local_db`
 * command. Node only; no app imports it.
 */
const workspace = resolve(import.meta.dirname, "../../..");

/** Builds the host with Cargo (a few minutes the first time) and resolves to its executable. */
export async function buildNativeHost(): Promise<string> {
  let stdout: string;
  try {
    ({ stdout } = await promisify(execFile)(
      "cargo",
      [
        "build",
        "--locked",
        "--package",
        "mustawfi-local-db",
        "--bin",
        "local-db-stdio",
        "--message-format=json-render-diagnostics",
      ],
      { cwd: workspace, maxBuffer: 64 * 1024 * 1024 },
    ));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("cargo is not on PATH: install Rust with rustup (see rust-toolchain.toml)", {
        cause: error,
      });
    }
    throw error;
  }
  let binary = "";
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    const message = JSON.parse(line) as { reason?: string; executable?: string | null };
    if (message.reason === "compiler-artifact" && typeof message.executable === "string") {
      binary = message.executable;
    }
  }
  if (binary === "") throw new Error("cargo built no local-db-stdio executable");
  return binary;
}

export interface NativeHost {
  readonly transport: NativeTransport;
  /** The host process, to kill it (a power cut) or to stop it at the end. */
  readonly process: ChildProcessWithoutNullStreams;
}

/**
 * A new host process of `binary` with its databases in `directory`: one native session, like one
 * run of the Windows app.
 */
export function startNativeHost(binary: string, directory: string): NativeHost {
  const host = spawn(binary, [directory]);
  const pending = new Map<number, (answer: Answer) => void>();
  type Answer =
    { id: number; ok: true; response: NativeResponse } | { id: number; ok: false; error: string };
  const failAll = (reason: string) => {
    for (const settle of pending.values()) settle({ id: 0, ok: false, error: reason });
    pending.clear();
  };
  createInterface({ input: host.stdout }).on("line", (line) => {
    const answer = JSON.parse(line) as Answer;
    // An answer without an id (a request the host could not read) fails everything waiting.
    if (typeof answer.id !== "number")
      failAll(answer.ok ? "an answer without an id" : answer.error);
    pending.get(answer.id)?.(answer);
    pending.delete(answer.id);
  });
  // A host that dies (a panic) fails its requests at once instead of hanging the test.
  host.on("exit", (code, signal) => {
    failAll(`the native host exited (${String(code ?? signal)})`);
  });
  let next = 0;
  const transport = (request: NativeRequest) =>
    new Promise<NativeResponse>((resolveAnswer, reject) => {
      next += 1;
      pending.set(next, (answer) => {
        if (answer.ok) resolveAnswer(answer.response);
        else reject(new Error(answer.error));
      });
      host.stdin.write(`${JSON.stringify({ id: next, request })}\n`);
    });
  return { transport, process: host };
}
