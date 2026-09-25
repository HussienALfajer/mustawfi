import { readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import * as prettier from "prettier";

/** The part of a Claude Code `PostToolUse` hook payload this hook reads. */
interface HookPayload {
  tool_input?: { file_path?: string };
}

export type FormatOutcome = "formatted" | "unchanged" | "skipped";

/** The edited file named in a hook payload, or `undefined` when there is none. */
export function editedFile(payload: unknown): string | undefined {
  const filePath = (payload as HookPayload | null)?.tool_input?.file_path;
  return typeof filePath === "string" && filePath.length > 0 ? filePath : undefined;
}

/**
 * Formats one file with the repository's Prettier config, honouring `.gitignore` and
 * `.prettierignore` like the Prettier CLI does.
 * Files outside the repository, ignored files, and file types Prettier does not know are skipped.
 */
export async function formatFile(rootDir: string, filePath: string): Promise<FormatOutcome> {
  const absolute = isAbsolute(filePath) ? filePath : resolve(rootDir, filePath);
  const fromRoot = relative(rootDir, absolute);
  if (
    fromRoot.startsWith("..") ||
    isAbsolute(fromRoot) ||
    fromRoot.split(/[\\/]/).includes("node_modules")
  ) {
    return "skipped";
  }

  const info = await prettier.getFileInfo(absolute, {
    ignorePath: [join(rootDir, ".gitignore"), join(rootDir, ".prettierignore")],
  });
  if (info.ignored || info.inferredParser === null) return "skipped";

  const source = readFileSync(absolute, "utf8");
  const config = (await prettier.resolveConfig(absolute)) ?? {};
  const formatted = await prettier.format(source, { ...config, filepath: absolute });
  if (formatted === source) return "unchanged";
  writeFileSync(absolute, formatted);
  return "formatted";
}
