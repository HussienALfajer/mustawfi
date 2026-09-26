import { spawn } from "node:child_process";
import { resolve } from "node:path";

/** The API server's package, where its CLIs run from. */
export const SERVER_DIR = resolve(import.meta.dirname, "../../server");

/** Runs a server CLI to completion and returns its standard output. */
export function runCli(
  script: string,
  args: string[],
  env: Record<string, string>,
  stdin = "",
): Promise<string> {
  return new Promise<string>((done, fail) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: SERVER_DIR,
      env: { ...process.env, ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", fail);
    child.on("close", (code) => {
      if (code === 0) done(stdout);
      else fail(new Error(`${script} exited with ${String(code)}:\n${stderr}`));
    });
    child.stdin.end(stdin);
  });
}
