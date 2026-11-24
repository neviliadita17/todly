use crate::db::Db;
use chrono::{DateTime, Local};
use rusqlite::{backup::Backup, Connection, OpenFlags};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

fn es(e: rusqlite::Error) -> String {
    e.to_string()
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn default_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("backups"))
}

fn setting(app: &AppHandle, key: &str) -> Option<String> {
    let db = app.state::<Db>();
    let c = db.0.lock().ok()?;
    c.query_row("SELECT value FROM application_settings WHERE key=?1", [key], |r| r.get::<_, String>(0))
        .ok()
        .filter(|v| !v.is_empty())
}

fn save_setting(app: &AppHandle, key: &str, val: Option<&str>) -> Result<(), String> {
    let db = app.state::<Db>();
    let c = db.0.lock().map_err(|e| e.to_string())?;
    match val {
        Some(v) => c
            .execute(
                "INSERT INTO application_settings(key,value) VALUES(?1,?2)
                 ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                rusqlite::params![key, v],
            )
            .map(|_| ()),
        None => c.execute("DELETE FROM application_settings WHERE key=?1", [key]).map(|_| ()),
    }
    .map_err(es)
}

/// Folder harus bisa dibuat dan ditulis.
fn usable_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|_| "Folder tidak bisa dibuat atau tidak ditemukan".to_string())?;
    let probe = dir.join(format!(".todly-write-test-{}", std::process::id()));
    std::fs::write(&probe, b"ok").map_err(|_| "Folder tidak bisa ditulis (cek izin atau drive)".to_string())?;
    let _ = std::fs::remove_file(&probe);
    Ok(())
}

/// Folder backup pilihan pengguna (atau default). Error jika tidak bisa dipakai.
fn target_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = match setting(app, "backup_dir") {
        Some(d) => PathBuf::from(d),
        None => default_dir(app)?,
    };
    usable_dir(&dir).map_err(|e| format!("{}: {}", e, dir.display()))?;
    Ok(dir)
}

/// Untuk proses otomatis: jika folder pilihan tidak bisa dipakai, pakai folder default.
fn target_dir_or_default(app: &AppHandle) -> PathBuf {
    match target_dir(app) {
        Ok(d) => d,
        Err(_) => {
            let d = default_dir(app).unwrap_or_else(|_| std::env::temp_dir());
            let _ = std::fs::create_dir_all(&d);
            d
        }
    }
}

/// Salin database yang sedang dipakai ke satu file yang rapi dan konsisten.
fn vacuum_to(c: &Connection, dest: &Path) -> Result<(), String> {
    if dest.exists() {
        std::fs::remove_file(dest).map_err(|e| e.to_string())?;
    }
    c.execute("VACUUM INTO ?1", [dest.to_string_lossy().to_string()])
        .map(|_| ())
        .map_err(es)
}

/// Ganti isi database `live` dengan isi file `src_path`.
/// Urutan: validasi file -> salinan pengaman data saat ini -> salin -> pastikan skema terbaru.
pub fn restore_inner(live: &mut Connection, src_path: &Path, safety: &Path) -> Result<(), String> {
    let src = Connection::open_with_flags(src_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|_| "File tidak bisa dibuka".to_string())?;
    let ok: String = src
        .query_row("PRAGMA integrity_check", [], |r| r.get(0))
        .map_err(|_| "File ini bukan database yang valid".to_string())?;
    if ok != "ok" {
        return Err("File backup rusak".into());
    }
    let tables: i64 = src
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('tasks','agendas','application_settings')",
            [],
            |r| r.get(0),
        )
        .map_err(|_| "File ini bukan database yang valid".to_string())?;
    if tables < 3 {
        return Err("File ini bukan backup Todly".into());
    }

    vacuum_to(live, safety)?;

    {
        let bk = Backup::new(&src, &mut *live).map_err(es)?;
        bk.run_to_completion(64, Duration::from_millis(5), None).map_err(es)?;
    }
    crate::db::ensure_schema(live)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupFile {
    pub name: String,
    pub size_bytes: u64,
    pub modified: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub path: String,
    pub size_bytes: u64,
    pub backups_dir: String,
    pub default_dir: String,
    pub is_default: bool,
    pub dir_ok: bool,
    pub backups: Vec<BackupFile>,
}

fn list_backups(dir: &Path) -> Vec<BackupFile> {
    let mut v: Vec<BackupFile> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map_or(false, |x| x == "db"))
                .filter_map(|e| {
                    let m = e.metadata().ok()?;
                    let t: DateTime<Local> = m.modified().ok()?.into();
                    Some(BackupFile {
                        name: e.file_name().to_string_lossy().to_string(),
                        size_bytes: m.len(),
                        modified: t.to_rfc3339(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.modified.cmp(&a.modified));
    v
}

/// Backup otomatis: satu file per hari di folder backup, simpan 7 terakhir (hanya file "auto-").
pub fn auto_backup(app: &AppHandle) {
    let bdir = target_dir_or_default(app);
    let dest = bdir.join(format!("auto-{}.db", Local::now().format("%Y-%m-%d")));
    if dest.exists() {
        return;
    }
    {
        let db = app.state::<Db>();
        if let Ok(c) = db.0.lock() {
            let _ = vacuum_to(&c, &dest);
        }
    }
    let mut autos: Vec<PathBuf> = std::fs::read_dir(&bdir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.file_name().map_or(false, |n| n.to_string_lossy().starts_with("auto-")))
                .collect()
        })
        .unwrap_or_default();
    autos.sort();
    while autos.len() > 7 {
        let _ = std::fs::remove_file(autos.remove(0));
    }
}

#[tauri::command]
pub fn db_info(app: AppHandle) -> Result<DbInfo, String> {
    let dir = data_dir(&app)?;
    let db = dir.join(crate::db::DB_FILE);
    let default = dir.join("backups");
    let configured = setting(&app, "backup_dir");
    let bdir = configured.clone().map(PathBuf::from).unwrap_or_else(|| default.clone());
    Ok(DbInfo {
        path: db.to_string_lossy().to_string(),
        size_bytes: std::fs::metadata(&db).map(|m| m.len()).unwrap_or(0),
        backups_dir: bdir.to_string_lossy().to_string(),
        default_dir: default.to_string_lossy().to_string(),
        is_default: configured.is_none(),
        dir_ok: bdir.is_dir() || configured.is_none(),
        backups: list_backups(&bdir),
    })
}

/// Pilih folder backup lewat dialog Windows dan simpan sebagai pengaturan.
#[tauri::command]
pub async fn choose_backup_dir(app: AppHandle) -> Result<Option<String>, String> {
    let Some(fp) = app.dialog().file().blocking_pick_folder() else {
        return Ok(None);
    };
    let dir = fp.into_path().map_err(|e| e.to_string())?;
    usable_dir(&dir)?;
    let s = dir.to_string_lossy().to_string();
    save_setting(&app, "backup_dir", Some(&s))?;
    Ok(Some(s))
}

#[tauri::command]
pub fn reset_backup_dir(app: AppHandle) -> Result<(), String> {
    save_setting(&app, "backup_dir", None)
}

/// Backup langsung ke folder backup (tanpa dialog).
#[tauri::command]
pub fn backup_now(app: AppHandle) -> Result<String, String> {
    let dir = target_dir(&app)?;
    let dest = dir.join(format!("Todly-backup-{}.db", Local::now().format("%Y-%m-%d_%H%M%S")));
    let db = app.state::<Db>();
    let c = db.0.lock().map_err(|e| e.to_string())?;
    vacuum_to(&c, &dest)?;
    Ok(dest.to_string_lossy().to_string())
}

/// "Simpan sebagai…": pilih lokasi sekali pakai.
#[tauri::command]
pub async fn backup_db(app: AppHandle) -> Result<Option<String>, String> {
    let name = format!("Todly-backup-{}.db", Local::now().format("%Y-%m-%d_%H%M"));
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("Database Todly", &["db"])
        .set_directory(target_dir_or_default(&app))
        .set_file_name(&name)
        .blocking_save_file()
    else {
        return Ok(None);
    };
    let dest = fp.into_path().map_err(|e| e.to_string())?;
    let db = app.state::<Db>();
    let c = db.0.lock().map_err(|e| e.to_string())?;
    vacuum_to(&c, &dest)?;
    Ok(Some(dest.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn restore_db(app: AppHandle) -> Result<Option<String>, String> {
    let Some(fp) = app
        .dialog()
        .file()
        .add_filter("Database Todly", &["db"])
        .set_directory(target_dir_or_default(&app))
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let src = fp.into_path().map_err(|e| e.to_string())?;
    let safety = target_dir_or_default(&app)
        .join(format!("before-restore-{}.db", Local::now().format("%Y-%m-%d_%H%M%S")));
    let keep = setting(&app, "backup_dir"); // pengaturan folder tidak ikut tertimpa isi backup
    {
        let db = app.state::<Db>();
        let mut c = db.0.lock().map_err(|e| e.to_string())?;
        restore_inner(&mut c, &src, &safety)?;
    }
    save_setting(&app, "backup_dir", keep.as_deref())?;
    let _ = app.emit("data-changed", ());
    Ok(Some(src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default()))
}

fn explorer(dir: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let prog = "explorer";
    #[cfg(target_os = "macos")]
    let prog = "open";
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    let prog = "xdg-open";
    std::process::Command::new(prog)
        .arg(dir)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_data_folder(app: AppHandle) -> Result<(), String> {
    explorer(data_dir(&app)?)
}

#[tauri::command]
pub fn open_backup_folder(app: AppHandle) -> Result<(), String> {
    explorer(target_dir(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{self, TaskInput};

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../migrations/001_init.sql")).unwrap();
        c
    }
    fn mk(c: &Connection, title: &str) {
        tasks::create_inner(
            c,
            &TaskInput {
                title: title.into(),
                description: None,
                priority: None,
                category_id: None,
                planned_start: None,
                due_at: None,
                notes: None,
            },
        )
        .unwrap();
    }
    fn count(c: &Connection) -> i64 {
        c.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn backup_restore_roundtrip_and_rejects_invalid_file() {
        let dir = std::env::temp_dir().join(format!("todly-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();

        let mut live = mem();
        mk(&live, "Asli");
        let file = dir.join("b.db");
        vacuum_to(&live, &file).unwrap();

        mk(&live, "Tambahan");
        assert_eq!(count(&live), 2);

        restore_inner(&mut live, &file, &dir.join("safe.db")).unwrap();
        assert_eq!(count(&live), 1);

        let safe = Connection::open(dir.join("safe.db")).unwrap();
        assert_eq!(count(&safe), 2);
        drop(safe);

        let bad = dir.join("bad.db");
        std::fs::write(&bad, b"ini bukan sqlite").unwrap();
        assert!(restore_inner(&mut live, &bad, &dir.join("safe2.db")).is_err());
        assert_eq!(count(&live), 1);

        let other = dir.join("other.db");
        Connection::open(&other).unwrap().execute_batch("CREATE TABLE x(a);").unwrap();
        assert!(restore_inner(&mut live, &other, &dir.join("safe3.db")).is_err());

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn usable_dir_checks_writability() {
        let dir = std::env::temp_dir().join(format!("todly-dir-{}", uuid::Uuid::new_v4()));
        assert!(usable_dir(&dir.join("a").join("b")).is_ok()); // dibuat otomatis
        let file = dir.join("f.txt");
        std::fs::write(&file, b"x").unwrap();
        assert!(usable_dir(&file.join("sub")).is_err()); // tidak bisa di dalam file
        std::fs::remove_dir_all(&dir).ok();
    }
}