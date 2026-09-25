import { serveLocalDbWorker } from "@mustawfi/local-db/worker";

/** The local database's worker (ADR-0019): SQLite WASM on the origin private file system. */
serveLocalDbWorker();
