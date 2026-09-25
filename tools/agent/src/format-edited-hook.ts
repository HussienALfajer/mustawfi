import { resolve } from "node:path";
import { text } from "node:stream/consumers";
import { editedFile, formatFile } from "./format-edited.ts";

// PostToolUse hook: formats the file an Edit or Write just touched.
// It never blocks the agent: a file Prettier cannot parse is reported and left as is.
const rootDir = resolve(import.meta.dirname, "../../..");
try {
  const filePath = editedFile(JSON.parse(await text(process.stdin)));
  if (filePath) await formatFile(rootDir, filePath);
} catch (error) {
  console.error(
    `format hook: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
  );
}
