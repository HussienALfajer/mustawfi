//! Mustawfi for Windows (ADR-0010): the web client in a WebView2 window, with its local
//! database in a real SQLite file owned by this process (ADR-0019).

// A release build is a GUI app: no console window behind it.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::Mutex;

use mustawfi_local_db::{Locate, Request, Response, Session};
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
        .invoke_handler(tauri::generate_handler![local_db])
        .run(tauri::generate_context!());
    if let Err(error) = result {
        eprintln!("mustawfi failed to start: {error}");
        std::process::exit(1);
    }
}
