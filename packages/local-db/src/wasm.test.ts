import { localDbContract } from "./contract.ts";
import { openWasmMemoryLocalDb } from "./wasm.ts";

// Under Node the WASM build has no persistent VFS: the browser opens it on OPFS in a worker
// (`worker.ts`), which the end-to-end journeys exercise.
localDbContract("WASM (SQLite WASM), in memory", {
  open: openWasmMemoryLocalDb,
  journalMode: "memory",
});
