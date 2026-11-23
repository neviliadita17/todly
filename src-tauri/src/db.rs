use rusqlite::Connection;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

/// Nama file database. Dipakai juga oleh backup.rs.
pub const DB_FILE: &str = "todly.db";

pub struct Db(pub Mutex<Connection>);

/// Membuat/memperbarui skema. Aman dijalankan berulang kali dan pada database lama.
pub fn ensure_schema(c: &Connection) -> Result<(), String> {
    let e = |x: rusqlite::Error| x.to_string();
    c.execute_batch(include_str!("../migrations/001_init.sql")).map_err(e)?;
    c.execute_batch(include_str!("../migrations/002_note_folders.sql")).map_err(e)?;
    // Database lama belum punya kolom folder_id pada tabel notes
    let has: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('notes') WHERE name='folder_id'",
            [],
            |r| r.get(0),
        )
        .map_err(e)?;
    if has == 0 {
        c.execute_batch(
            "ALTER TABLE notes ADD COLUMN folder_id TEXT REFERENCES note_folders(id) ON DELETE SET NULL;",
        )
        .map_err(e)?;
    }
    c.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_notes_folder ON notes(folder_id) WHERE deleted_at IS NULL;",
    )
    .map_err(e)?;
    Ok(())
}

pub fn init(app: &AppHandle) -> Result<Db, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let conn = Connection::open(dir.join(DB_FILE)).map_err(|e| e.to_string())?;
    ensure_schema(&conn)?;
    Ok(Db(Mutex::new(conn)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upgrades_old_notes_table() {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(
            "CREATE TABLE notes (id TEXT PRIMARY KEY, content TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0,
               created_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT '', deleted_at TEXT);
             INSERT INTO notes(id,content) VALUES('1','lama');",
        )
        .unwrap();
        ensure_schema(&c).unwrap();
        ensure_schema(&c).unwrap(); // aman dijalankan berulang
        let (n, f): (i64, Option<String>) = c
            .query_row("SELECT COUNT(*), MAX(folder_id) FROM notes", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(n, 1); // catatan lama tetap ada
        assert!(f.is_none());
    }
}