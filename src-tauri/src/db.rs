use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Nama file database. Dipakai juga oleh backup.rs.
pub const DB_FILE: &str = "todly.db";

pub struct Db(pub Mutex<Connection>);

pub fn init(app: &AppHandle) -> Result<Db, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join(DB_FILE)).map_err(|e| e.to_string())?;
    conn.execute_batch(include_str!("../migrations/001_init.sql"))
        .map_err(|e| e.to_string())?;
    Ok(Db(Mutex::new(conn)))
}