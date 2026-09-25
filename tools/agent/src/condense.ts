/**
 * Shrinks command output to what an agent needs: failures and summaries.
 * Full logs are kept on disk by the caller; this only decides what to print.
 */

// eslint-disable-next-line no-control-regex -- matching terminal escape codes is the point
const ansiPattern = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007/g;

/** Lines that usually carry the reason a step failed. */
const signalPattern =
  /\berror\b|\bfail(ed|ure|s)?\b|✖|✗|×|❯|\bFAIL\b|\bERR!|\bwarning\b|AssertionError|expected|Tests? +\d|Test Files|violation/i;

export interface CondenseOptions {
  /** Lines always kept from the end of the output (summaries live there). */
  tailLines?: number;
  /** Lines kept after each signal line, for the message that follows it. */
  contextAfter?: number;
  /** Hard cap on printed lines. */
  maxLines?: number;
}

export function stripAnsi(text: string): string {
  return text.replace(ansiPattern, "");
}

/**
 * Keeps signal lines (with a little context after each) plus the tail,
 * in their original order, and marks each skipped stretch with a gap line.
 */
export function condense(output: string, options: CondenseOptions = {}): string {
  const { tailLines = 30, contextAfter = 3, maxLines = 120 } = options;
  const lines = stripAnsi(output)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
  while (lines.length > 0 && lines.at(-1) === "") lines.pop();

  const keep = new Set<number>();
  for (let i = Math.max(0, lines.length - tailLines); i < lines.length; i++) keep.add(i);
  lines.forEach((line, i) => {
    if (!signalPattern.test(line)) return;
    for (let j = i; j <= Math.min(lines.length - 1, i + contextAfter); j++) keep.add(j);
  });

  let indices = [...keep].sort((a, b) => a - b);
  if (indices.length > maxLines) {
    // Prefer the end: the first error and the final summary matter most, and the tail holds the summary.
    const head = indices.slice(0, Math.floor(maxLines / 3));
    indices = [...head, ...indices.slice(indices.length - (maxLines - head.length))];
  }

  const out: string[] = [];
  let previous = -1;
  for (const i of indices) {
    if (i > previous + 1) out.push(`  … ${i - previous - 1} line(s) omitted`);
    out.push(lines[i] ?? "");
    previous = i;
  }
  return out.join("\n");
}
