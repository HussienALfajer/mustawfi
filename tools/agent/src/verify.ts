import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { condense } from "./condense.ts";

export interface VerifyStep {
  /** The root `package.json` script this step stands for. */
  script: string;
  /** The command actually run; differs from `pnpm run <script>` only to quiet a reporter. */
  command: string;
}

/**
 * The steps of `pnpm verify`, in order. A test keeps this list equal to the
 * root `verify` script, so the agent's gate is never weaker than CI's.
 */
export const verifySteps: readonly VerifyStep[] = [
  { script: "build", command: "pnpm run build" },
  { script: "format:check", command: "pnpm run format:check" },
  { script: "lint", command: "pnpm run lint" },
  { script: "typecheck", command: "pnpm run typecheck" },
  { script: "check:boundaries", command: "pnpm run check:boundaries" },
  // Same run as `pnpm test`; the minimal reporter prints only failures and the summary.
  { script: "test", command: "pnpm exec vitest run --reporter=minimal" },
  { script: "test:e2e", command: "pnpm run test:e2e" },
];

/** Script names chained by `&&` in a `pnpm verify`-style script. */
export function scriptsInChain(chain: string): string[] {
  return chain.split("&&").map((part) => {
    const match = /^pnpm (?:run )?(\S+)$/.exec(part.trim());
    if (!match?.[1]) throw new Error(`Unexpected verify step: "${part.trim()}"`);
    return match[1];
  });
}

interface StepResult {
  exitCode: number;
  output: string;
  seconds: number;
}

function run(command: string, cwd: string): Promise<StepResult> {
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (output += chunk.toString()));
    const finish = (exitCode: number) =>
      resolve({ exitCode, output, seconds: (performance.now() - started) / 1000 });
    child.on("error", (error) => {
      output += `\n${error.message}`;
      finish(1);
    });
    child.on("close", (code) => finish(code ?? 1));
  });
}

/**
 * Runs every step in order and stops at the first failure, like `&&`.
 * Prints one line per passing step and a condensed log for the failing one;
 * full logs go to `node_modules/.cache/mustawfi-verify/`.
 * @returns the process exit code
 */
export async function verify(
  rootDir: string,
  steps: readonly VerifyStep[] = verifySteps,
): Promise<number> {
  const logDir = join(rootDir, "node_modules", ".cache", "mustawfi-verify");
  mkdirSync(logDir, { recursive: true });

  for (const step of steps) {
    const result = await run(step.command, rootDir);
    const logFile = join(logDir, `${step.script.replace(/[^\w-]/g, "-")}.log`);
    writeFileSync(logFile, result.output);
    const time = `${result.seconds.toFixed(1)}s`;

    if (result.exitCode === 0) {
      console.log(`✔ ${step.script} (${time})`);
      continue;
    }
    console.log(`✖ ${step.script} failed (exit ${result.exitCode}, ${time})`);
    console.log(condense(result.output));
    console.log(`\nFull log: ${relative(rootDir, logFile)}`);
    console.log(`verify: FAILED at ${step.script}`);
    return 1;
  }
  console.log("verify: PASSED");
  return 0;
}
