/** What a command reads and writes, so tests run it in-process. */
export interface CommandIo {
  readonly argv: readonly string[];
  readonly stdout: { write(text: string): unknown };
  readonly stderr: { write(text: string): unknown };
}

/** The process's own streams and arguments. */
export function processIo(): CommandIo {
  return { argv: process.argv.slice(2), stdout: process.stdout, stderr: process.stderr };
}
