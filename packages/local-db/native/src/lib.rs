//! The native core of `LocalDb` (ADR-0019): one SQLite connection, driven by requests.
//!
//! The TypeScript adapter (`@mustawfi/local-db/native`) sends one request at a time and keeps
//! transactions itself (`BEGIN IMMEDIATE` … `COMMIT` as ordinary statements). Every statement
//! therefore runs on this one connection, which is what makes multi-statement transactions
//! hold — unlike a connection pool, where `BEGIN` and `COMMIT` may reach different connections.
//!
//! The Windows shell exposes [`Session::handle`] as a Tauri command; the `local-db-stdio`
//! binary exposes it over stdin/stdout, so the `LocalDb` contract suite runs against this code.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::types::{Value, ValueRef};
use rusqlite::{Connection, params_from_iter};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A value on the wire. Integers travel as decimal strings (a JSON number would lose 64-bit
/// precision in JavaScript), reals as strings too (JSON has no infinity), blobs as base64.
/// SQL `NULL` is JSON `null`, carried as `None` around this type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum WireValue {
    #[serde(rename = "i", with = "as_string")]
    Integer(i64),
    #[serde(rename = "r", with = "as_string")]
    Real(f64),
    #[serde(rename = "t")]
    Text(String),
    #[serde(rename = "b", with = "as_base64")]
    Blob(Vec<u8>),
}

mod as_string {
    use super::{Deserialize, Deserializer, Serializer};
    use std::fmt::Display;
    use std::str::FromStr;

    pub fn serialize<T: Display, S: Serializer>(
        value: &T,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        serializer.collect_str(value)
    }

    pub fn deserialize<'de, T, D>(deserializer: D) -> Result<T, D::Error>
    where
        T: FromStr,
        T::Err: Display,
        D: Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        text.parse().map_err(serde::de::Error::custom)
    }
}

mod as_base64 {
    use super::{BASE64, Deserialize, Deserializer, Serializer};
    use base64::Engine as _;

    pub fn serialize<S: Serializer>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&BASE64.encode(bytes))
    }

    pub fn deserialize<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<u8>, D::Error> {
        let text = String::deserialize(deserializer)?;
        BASE64.decode(text).map_err(serde::de::Error::custom)
    }
}

/// What the adapter asks for.
#[derive(Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Request {
    /// Opens the named database, closing (and so rolling back) any connection already open —
    /// a reloaded page must not find a transaction its previous life left behind.
    Open {
        name: String,
    },
    /// Runs one statement.
    Run {
        sql: String,
        params: Vec<Option<WireValue>>,
    },
    /// Copies the database with `VACUUM INTO` next to it, in `backups/`, keeping the newest
    /// `keep` copies (ADR-0019). Skipped while a transaction is open, or when the newest copy
    /// is younger than `min_age_ms`.
    Backup {
        keep: usize,
        min_age_ms: Option<u64>,
    },
    Close,
}

/// What the core answers.
#[derive(Debug, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum Response {
    Opened,
    Ran {
        columns: Vec<String>,
        rows: Vec<Vec<Option<WireValue>>>,
        changes: u64,
    },
    /// The copy's file name, or `None` when the backup was skipped.
    BackedUp {
        file: Option<String>,
    },
    Closed,
}

/// Where a database name lives on this host.
pub trait Locate {
    fn database_path(&self, name: &str) -> Result<PathBuf, String>;
}

/// Names Windows maps to devices, with or without an extension (`nul.sqlite3` is the NUL device).
const WINDOWS_DEVICE_NAMES: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// A database name: lowercase letters, digits, and dashes, so it can never leave its directory,
/// and never a Windows device name.
fn check_name(name: &str) -> Result<(), String> {
    let valid = !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !name.starts_with('-')
        && !WINDOWS_DEVICE_NAMES.contains(&name);
    if valid {
        Ok(())
    } else {
        Err(format!("invalid local database name: {name:?}"))
    }
}

struct Open {
    connection: Connection,
    path: PathBuf,
    name: String,
}

/// One client's connection. Hosts serialize calls (a mutex in the shell, one reader over stdio).
#[derive(Default)]
pub struct Session {
    open: Option<Open>,
}

impl Session {
    pub fn handle(&mut self, request: Request, locate: &impl Locate) -> Result<Response, String> {
        match request {
            Request::Open { name } => {
                check_name(&name)?;
                let path = locate.database_path(&name)?;
                // Dropping a connection rolls back whatever transaction it still had open.
                self.open = None;
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let connection = Connection::open(&path).map_err(|e| e.to_string())?;
                self.open = Some(Open {
                    connection,
                    path,
                    name,
                });
                Ok(Response::Opened)
            }
            Request::Run { sql, params } => run(&self.connection()?.connection, &sql, params),
            Request::Backup { keep, min_age_ms } => backup(self.connection()?, keep, min_age_ms),
            Request::Close => {
                self.open = None;
                Ok(Response::Closed)
            }
        }
    }

    fn connection(&self) -> Result<&Open, String> {
        self.open
            .as_ref()
            .ok_or_else(|| "the local database is not open".to_owned())
    }
}

fn to_sql(value: Option<WireValue>) -> Value {
    match value {
        None => Value::Null,
        Some(WireValue::Integer(i)) => Value::Integer(i),
        Some(WireValue::Real(r)) => Value::Real(r),
        Some(WireValue::Text(t)) => Value::Text(t),
        Some(WireValue::Blob(b)) => Value::Blob(b),
    }
}

fn from_sql(value: ValueRef<'_>) -> Result<Option<WireValue>, String> {
    Ok(match value {
        ValueRef::Null => None,
        ValueRef::Integer(i) => Some(WireValue::Integer(i)),
        ValueRef::Real(r) => Some(WireValue::Real(r)),
        ValueRef::Text(bytes) => Some(WireValue::Text(
            String::from_utf8(bytes.to_vec()).map_err(|e| e.to_string())?,
        )),
        ValueRef::Blob(bytes) => Some(WireValue::Blob(bytes.to_vec())),
    })
}

/// Runs one statement: rows for one that has columns, the changed-row count for the others.
fn run(
    connection: &Connection,
    sql: &str,
    params: Vec<Option<WireValue>>,
) -> Result<Response, String> {
    let mut statement = connection.prepare(sql).map_err(|e| e.to_string())?;
    let columns: Vec<String> = statement
        .column_names()
        .into_iter()
        .map(str::to_owned)
        .collect();
    let values = params_from_iter(params.into_iter().map(to_sql));
    if columns.is_empty() {
        let changes = statement.execute(values).map_err(|e| e.to_string())?;
        return Ok(Response::Ran {
            columns,
            rows: Vec::new(),
            changes: changes as u64,
        });
    }
    let mut rows = Vec::new();
    let mut cursor = statement.query(values).map_err(|e| e.to_string())?;
    while let Some(row) = cursor.next().map_err(|e| e.to_string())? {
        let mut values = Vec::with_capacity(columns.len());
        for index in 0..columns.len() {
            values.push(from_sql(row.get_ref(index).map_err(|e| e.to_string())?)?);
        }
        rows.push(values);
    }
    Ok(Response::Ran {
        columns,
        rows,
        changes: 0,
    })
}

fn now_ms() -> Result<u64, String> {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?;
    u64::try_from(elapsed.as_millis()).map_err(|e| e.to_string())
}

/// The backups of `name` in `directory`, newest first, with the time each was taken.
fn existing_backups(directory: &Path, name: &str) -> Result<Vec<(u64, PathBuf)>, String> {
    let prefix = format!("{name}-");
    let mut found = Vec::new();
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(found),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let file = entry.file_name();
        let Some(stamp) = file
            .to_str()
            .and_then(|f| f.strip_prefix(&prefix))
            .and_then(|f| f.strip_suffix(".sqlite3"))
            .and_then(|f| f.parse::<u64>().ok())
        else {
            continue;
        };
        found.push((stamp, entry.path()));
    }
    found.sort_by_key(|(stamp, _)| std::cmp::Reverse(*stamp));
    Ok(found)
}

/// Whether a copy is due: always without a minimum age or an earlier copy; otherwise when the
/// newest copy is at least `min_age_ms` old — or stamped in the future, because the clock went
/// back (a dead CMOS battery), which must not stop the daily copy until the clock catches up.
fn backup_due(newest: Option<u64>, now: u64, min_age_ms: Option<u64>) -> bool {
    match (newest, min_age_ms) {
        (Some(newest), Some(min_age)) => newest > now || now - newest >= min_age,
        _ => true,
    }
}

fn backup(open: &Open, keep: usize, min_age_ms: Option<u64>) -> Result<Response, String> {
    if keep == 0 {
        return Err("a backup must keep at least one copy".to_owned());
    }
    // `VACUUM` cannot run inside a transaction; the caller tries again later.
    if !open.connection.is_autocommit() {
        return Ok(Response::BackedUp { file: None });
    }
    let directory = open
        .path
        .parent()
        .map_or_else(|| PathBuf::from("backups"), |p| p.join("backups"));
    let now = now_ms()?;
    let backups = existing_backups(&directory, &open.name)?;
    if !backup_due(backups.first().map(|(newest, _)| *newest), now, min_age_ms) {
        return Ok(Response::BackedUp { file: None });
    }
    fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    // Never the same millisecond as an existing copy: `VACUUM INTO` refuses an existing file.
    let stamp = backups
        .first()
        .map_or(now, |(newest, _)| now.max(newest + 1));
    let file = format!("{}-{stamp}.sqlite3", open.name);
    let target = directory.join(&file);
    let target_text = target
        .to_str()
        .ok_or_else(|| "the backup path is not valid UTF-8".to_owned())?;
    open.connection
        .execute("VACUUM INTO ?1", [target_text])
        .map_err(|e| e.to_string())?;
    // The new copy is written; only now drop the oldest beyond `keep`.
    for (_, path) in existing_backups(&directory, &open.name)?.iter().skip(keep) {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(Response::BackedUp { file: Some(file) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn database_names_stay_in_their_directory() {
        assert!(check_name("mustawfi").is_ok());
        assert!(check_name("contract-12").is_ok());
        for bad in [
            "",
            "../x",
            "a/b",
            "a\\b",
            "A",
            "-x",
            "x.sqlite3",
            "nul",
            "con",
            "com1",
            &"a".repeat(65),
        ] {
            assert!(check_name(bad).is_err(), "{bad:?} was accepted");
        }
    }

    #[test]
    fn a_daily_copy_is_due_after_a_day_or_when_the_clock_went_back() {
        let day = 86_400_000;
        assert!(backup_due(None, 1_000, Some(day)));
        assert!(backup_due(Some(1_000), 1_000, None));
        assert!(!backup_due(Some(1_000), 1_000 + day - 1, Some(day)));
        assert!(backup_due(Some(1_000), 1_000 + day, Some(day)));
        // The newest copy is from "the future": the clock was set back.
        assert!(backup_due(Some(5 * day), day, Some(day)));
    }

    #[test]
    fn wire_values_round_trip_exactly() {
        let values = vec![
            Some(WireValue::Integer(i64::MAX)),
            Some(WireValue::Integer(i64::MIN)),
            Some(WireValue::Real(0.1)),
            Some(WireValue::Real(f64::INFINITY)),
            Some(WireValue::Text("متجر ١٢".to_owned())),
            Some(WireValue::Blob(vec![0, 1, 255])),
            None,
        ];
        let json = serde_json::to_string(&values).expect("serializes");
        assert_eq!(
            json,
            r#"[{"i":"9223372036854775807"},{"i":"-9223372036854775808"},{"r":"0.1"},{"r":"inf"},{"t":"متجر ١٢"},{"b":"AAH/"},null]"#
        );
        let back: Vec<Option<WireValue>> = serde_json::from_str(&json).expect("parses");
        assert_eq!(back, values);
    }
}
