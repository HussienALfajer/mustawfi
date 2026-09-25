# 0019. Native SQLite on Windows and Android, SQLite WASM in the browser, behind one LocalDb interface

- Status: Accepted
- Date: 2026-09-25

## Context

Every client keeps a local database and an outbox (ADR-0005). A POS holds sales that exist nowhere else until they sync, in shops where the power drops. ADR-0010 rejected the browser as the primary POS partly because browser storage can be evicted. Shift totals and cash counts are computed locally and must be exact. The same client code runs in Tauri (Windows), Capacitor (Android), and the browser.

## Decision

- **Windows (Tauri):** a real SQLite file in the app's data directory, opened on the Rust side and exposed to the UI through a small set of commands that run a batch of statements in one transaction. Whether that is `tauri-plugin-sql` or a custom `rusqlite` command set is settled by a spike in the walking skeleton; multi-statement transactions are a hard requirement.
- **Android (Capacitor):** native SQLite through `@capacitor-community/sqlite`.
- **Browser/PWA:** the official SQLite WASM build on OPFS in a worker, with `navigator.storage.persist()` requested. The browser remains "limited offline" (ADR-0010) and is never a main POS.
- **Tests:** a Node adapter (`node:sqlite` or `better-sqlite3`) used by unit tests and the sync simulation harness (ADR-0026).
- **One interface:** `packages/local-db` defines `LocalDb` (`query`, `exec`, `transaction(fn)`, change notifications per table). Drizzle's `sqlite-proxy` sits on top, so modules write local queries the same way they write server queries.
- **Durability:** WAL mode with `synchronous = FULL`, so a committed sale survives a power cut. A sale, its outbox entry, and its document-number increment commit in one local transaction.
- **Local schema:** each module's `client` entry declares its local tables; migrations ship with the app version and run at start-up before the outbox is opened. The local database is copied (`VACUUM INTO`) before every migration and once a day, keeping the last few copies — the device-side backup required by `v1-scope.md` §7.
- **Contents:** master data for the user's scope, the device's own documents, the outbox, local balances (stock per location, cash per box and shift, customer balances), the signed configuration bundle, and the queue of items that need review.
- **Encryption at rest:** not for the whole database in V1. Sensitive fields (repair passcodes) are encrypted at field level with a key held in the OS keystore. Full-database encryption (SQLCipher) is revisited if customers or regulation require it.

## Consequences

- A sale survives a power cut, a browser storage purge cannot touch the POS, and support can inspect or recover a database file.
- Three adapters to maintain, all tested against the same `LocalDb` contract suite.
- Money stored as scaled integers (ADR-0018) keeps local `SUM`s exact.
- **Windows binding, settled by the walking-skeleton spike (slice 13, 2026-09-25): a custom `rusqlite` command set, not `tauri-plugin-sql`.** `tauri-plugin-sql` 2.4.1 runs statements through an sqlx connection pool, so `BEGIN`, the statements, and `COMMIT` sent as separate calls may reach different connections; it has no transaction API (plugins-workspace issue #886, open since January 2024). The native core (`packages/local-db/native`, crate `mustawfi-local-db`, `rusqlite` 0.40 with its bundled SQLite) holds **one** connection and answers one request at a time — `open`, `run` (one statement), `backup`, `close` — through a single Tauri command, `local_db`. Transactions stay in the shared TypeScript core (`BEGIN IMMEDIATE` … `COMMIT` as ordinary statements), so they behave the same on every adapter. Values cross as tagged JSON (`i` integer as a decimal string, `r` real as a string, `t` text, `b` base64 blob), so a 64-bit integer never passes through a JavaScript `number`. Opening again closes the previous connection, which rolls back a transaction a reloaded page left open. A stdio host of the same core runs the `LocalDb` contract suite in Vitest.
- The "batch of statements in one transaction" command set named above became a one-statement command: a batch cannot run the reads a sale needs between its writes (the cart, the next number), while one connection per client already makes multi-statement transactions atomic.

## Alternatives considered

- **SQLite WASM inside the webview everywhere** — one adapter, but webview storage can be cleared under storage pressure on Android, the risk ADR-0010 rejected.
- **IndexedDB (Dexie)** — no SQL or fast aggregates for shift reports, and the same eviction risk.
- **SQLCipher from day one** — added build complexity on both platforms before any customer asks for it.
