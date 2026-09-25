import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";
import { localDbContract } from "./contract.ts";
import { openNodeLocalDb } from "./node.ts";

const directory = mkdtempSync(join(tmpdir(), "mustawfi-local-db-"));
let opened = 0;
afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

localDbContract("Node (node:sqlite), on a file", {
  open: () => {
    opened += 1;
    return Promise.resolve(openNodeLocalDb(join(directory, `contract-${String(opened)}.sqlite3`)));
  },
  journalMode: "wal",
});
