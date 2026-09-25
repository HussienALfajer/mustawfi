//! Serves the native `LocalDb` core over stdin/stdout, one JSON line per request and answer:
//! `{"id":1,"request":{...}}` → `{"id":1,"ok":true,"response":{...}}` or
//! `{"id":1,"ok":false,"error":"..."}`. Databases live in the directory given as the only
//! argument. The contract suite (`packages/local-db/src/native.test.ts`) drives it.

use std::io::{self, BufRead, Write};
use std::path::PathBuf;
use std::process::ExitCode;

use mustawfi_local_db::{Locate, Request, Session};
use serde::Deserialize;
use serde_json::json;

#[derive(Deserialize)]
struct Envelope {
    id: u64,
    request: Request,
}

struct Directory(PathBuf);

impl Locate for Directory {
    fn database_path(&self, name: &str) -> Result<PathBuf, String> {
        Ok(self.0.join(format!("{name}.sqlite3")))
    }
}

fn main() -> ExitCode {
    let Some(directory) = std::env::args_os().nth(1).map(PathBuf::from) else {
        eprintln!("usage: local-db-stdio <directory>");
        return ExitCode::FAILURE;
    };
    let locate = Directory(directory);
    let mut session = Session::default();
    let stdout = io::stdout();
    for line in io::stdin().lock().lines() {
        let Ok(line) = line else {
            return ExitCode::FAILURE;
        };
        let answer = match serde_json::from_str::<Envelope>(&line) {
            Ok(envelope) => match session.handle(envelope.request, &locate) {
                Ok(response) => json!({ "id": envelope.id, "ok": true, "response": response }),
                Err(error) => json!({ "id": envelope.id, "ok": false, "error": error }),
            },
            Err(error) => json!({ "id": null, "ok": false, "error": error.to_string() }),
        };
        let mut out = stdout.lock();
        if writeln!(out, "{answer}")
            .and_then(|()| out.flush())
            .is_err()
        {
            return ExitCode::FAILURE;
        }
    }
    ExitCode::SUCCESS
}
