//! Mustawfi for Windows (ADR-0010): the web client in a WebView2 window, with its local
//! database in a real SQLite file owned by this process (ADR-0019), and receipts sent to the
//! printer as raw ESC/POS bytes through the Windows spooler (ADR-0025).

// A release build is a GUI app: no console window behind it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use mustawfi_local_db::{Locate, Request, Response, Session};
use mustawfi_printing::PrinterInfo;
use tauri::{Manager, State};

/// The one native session of the app's window: every statement runs on its connection, and
/// its databases live in the app's local (not roaming) data directory.
struct LocalDbSession {
    session: Mutex<Session>,
    directory: AppLocalData,
}

struct AppLocalData(PathBuf);

impl Locate for AppLocalData {
    fn database_path(&self, name: &str) -> Result<PathBuf, String> {
        Ok(self.0.join(format!("{name}.sqlite3")))
    }
}

/// The `LocalDb` protocol of `@mustawfi/local-db/native`: one request at a time.
#[tauri::command]
async fn local_db(request: Request, state: State<'_, LocalDbSession>) -> Result<Response, String> {
    // A panic mid-request leaves the connection usable; a poisoned lock must not stop the till.
    let mut session = state
        .session
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    session.handle(request, &state.directory)
}

/// The printers this Windows user can print to (`@mustawfi/printing/tauri`).
#[tauri::command]
async fn printers() -> Result<Vec<PrinterInfo>, String> {
    tauri::async_runtime::spawn_blocking(mustawfi_printing::list_printers)
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// Sends one job of ESC/POS bytes (base64 on the wire) to a printer as RAW; returns the job id.
/// The spooler calls block, so they run off the async runtime.
#[tauri::command]
async fn print_raw(printer: String, document: String, bytes: String) -> Result<u32, String> {
    let bytes = BASE64
        .decode(bytes)
        .map_err(|error| format!("invalid job bytes: {error}"))?;
    tauri::async_runtime::spawn_blocking(move || {
        mustawfi_printing::print_raw(&printer, &document, &bytes)
    })
    .await
    .map_err(|error| error.to_string())?
    .map_err(|error| error.to_string())
}

fn main() {
    let result = tauri::Builder::default()
        .setup(|app| {
            let directory = app.path().app_local_data_dir()?;
            app.manage(LocalDbSession {
                session: Mutex::new(Session::default()),
                directory: AppLocalData(directory),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![local_db, printers, print_raw])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("mustawfi failed to start: {error}");
        std::process::exit(1);
    }
}
