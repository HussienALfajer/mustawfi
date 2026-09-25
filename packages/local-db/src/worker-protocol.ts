import type { LocalValue, StatementResult } from "./local-db.ts";

/** Messages from the page to the local-database worker. */
export type WorkerRequest =
  | { readonly id: number; readonly kind: "open"; readonly name: string }
  | {
      readonly id: number;
      readonly kind: "run";
      readonly sql: string;
      readonly params: readonly LocalValue[];
    }
  | { readonly id: number; readonly kind: "close" };

/** What the worker found after opening: the journal mode and synchronous level in effect. */
export interface OpenedDurability {
  readonly journalMode: string;
  readonly synchronous: string;
}

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly result?: StatementResult | OpenedDurability }
  | { readonly id: number; readonly ok: false; readonly message: string; readonly name: string };
