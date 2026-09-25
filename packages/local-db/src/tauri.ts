import { invoke } from "@tauri-apps/api/core";
import {
  type NativeLocalDb,
  type NativeRequest,
  type NativeResponse,
  type NativeTransport,
  openNativeLocalDb,
} from "./native.ts";

export { isTauri } from "@tauri-apps/api/core";

/** The Windows shell's `local_db` command (`apps/desktop/src-tauri`). */
const tauriTransport: NativeTransport = (request: NativeRequest) =>
  invoke<NativeResponse>("local_db", { request });

/** Opens the Windows app's local database: a SQLite file in the app's data directory. */
export function openTauriLocalDb(name: string): Promise<NativeLocalDb> {
  return openNativeLocalDb(tauriTransport, name);
}
