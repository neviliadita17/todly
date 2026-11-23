use crate::db::Db;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, params_from_iter, Connection, Row};
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub content: String,
    pub pinned: bool,
    pub folder_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Ringkasan untuk daftar: tanpa isi lengkap (isi bisa berisi gambar besar).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteItem {
    pub id: String,
    pub preview: String,
    pub pinned: bool,
    pub folder_id: Option<String>,
    pub folder_name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub count: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderList {
    pub folders: Vec<Folder>,
    pub total: i64,
    pub unfiled: i64,
}

const COLS: &str = "id,content,pinned,folder_id,created_at,updated_at";
const EMPTY: &str = "trim(content, ' ' || char(9) || char(10) || char(13)) = ''";

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn row(r: &Row) -> rusqlite::Result<Note> {
    Ok(Note {
        id: r.get(0)?,
        content: r.get(1)?,
        pinned: r.get::<_, i64>(2)? != 0,
        folder_id: r.get(3)?,
        created_at: r.get(4)?,
        updated_at: r.get(5)?,
    })
}

/// Teks polos dari isi catatan (HTML dari editor, atau teks biasa dari catatan lama).
pub fn plain_text(content: &str) -> String {
    if !content.trim_start().starts_with('<') {
        return content.to_string();
    }
    let mut out = String::new();
    let mut tag = String::new();
    let mut in_tag = false;
    for ch in content.chars() {
        if in_tag {
            if ch == '>' {
                in_tag = false;
                let t = tag.trim().to_lowercase();
                let closing = t.starts_with('/');
                let name = t
                    .trim_start_matches('/')
                    .split(|c: char| c.is_whitespace() || c == '/')
                    .next()
                    .unwrap_or("")
                    .to_string();
                if name == "br" || (closing && matches!(name.as_str(), "p" | "h1" | "h2" | "h3" | "li" | "tr" | "div")) {
                    out.push('\n');
                }
                tag.clear();
            } else if tag.len() < 32 {
                tag.push(ch);
            }
        } else if ch == '<' {
            in_tag = true;
        } else {
            out.push(ch);
        }
    }
    out.replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&")
}

pub fn get_inner(c: &Connection, id: &str) -> Result<Note, String> {
    c.query_row(
        &format!("SELECT {COLS} FROM notes WHERE id=?1 AND deleted_at IS NULL"),
        [id],
        row,
    )
    .map_err(|_| "Catatan tidak ditemukan".to_string())
}

fn folder_exists(c: &Connection, id: &str) -> Result<bool, String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM note_folders WHERE id=?1 AND deleted_at IS NULL",
            [id],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(n > 0)
}

/// `folder`: "all" = semua catatan, "none" = tanpa folder, selain itu = id folder.
pub fn list_inner(c: &Connection, query: &str, folder: &str) -> Result<Vec<NoteItem>, String> {
    let (clause, arg): (&str, Option<String>) = match folder {
        "" | "all" => ("", None),
        "none" => (" AND n.folder_id IS NULL", None),
        id => (" AND n.folder_id = ?1", Some(id.to_string())),
    };
    let mut st = c
        .prepare(&format!(
            "SELECT n.id, n.content, n.pinned, n.folder_id, f.name, n.created_at, n.updated_at
             FROM notes n LEFT JOIN note_folders f ON f.id = n.folder_id AND f.deleted_at IS NULL
             WHERE n.deleted_at IS NULL AND NOT ({EMPTY}){clause}
             ORDER BY n.pinned DESC, n.updated_at DESC"
        ))
        .map_err(err)?;
    let q = query.trim().to_lowercase();
    let rows = st
        .query_map(params_from_iter(arg.iter()), |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, Option<String>>(3)?,
                r.get::<_, Option<String>>(4)?,
                r.get::<_, String>(5)?,
                r.get::<_, String>(6)?,
            ))
        })
        .map_err(err)?;
    let mut out = vec![];
    for r in rows {
        let (id, content, pinned, folder_id, folder_name, created_at, updated_at) = r.map_err(err)?;
        let text = plain_text(&content);
        if !q.is_empty() && !text.to_lowercase().contains(&q) {
            continue;
        }
        let mut preview = text
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty())
            .take(3)
            .map(|l| l.chars().take(200).collect::<String>())
            .collect::<Vec<_>>()
            .join("\n");
        if preview.is_empty() && content.contains("<img") {
            preview = "Gambar".into();
        }
        out.push(NoteItem { id, preview, pinned: pinned != 0, folder_id, folder_name, created_at, updated_at });
    }
    Ok(out)
}

/// Catatan baru masuk ke `folder` (diabaikan jika folder tidak ada). Catatan kosong lama dibuang.
pub fn create_inner(c: &Connection, folder: Option<&str>) -> Result<Note, String> {
    let t = now();
    c.execute(
        &format!("UPDATE notes SET deleted_at=?1 WHERE deleted_at IS NULL AND ({EMPTY})"),
        [&t],
    )
    .map_err(err)?;
    let fid = match folder {
        Some(f) if folder_exists(c, f)? => Some(f.to_string()),
        _ => None,
    };
    let id = uuid::Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO notes(id,content,folder_id,created_at,updated_at) VALUES(?1,'',?2,?3,?3)",
        params![id, fid, t],
    )
    .map_err(err)?;
    get_inner(c, &id)
}

/// Tanggal/jam hanya berubah jika isi benar-benar berubah.
pub fn update_inner(c: &Connection, id: &str, content: &str) -> Result<(), String> {
    c.execute(
        "UPDATE notes SET content=?2, updated_at=?3
         WHERE id=?1 AND deleted_at IS NULL AND content IS NOT ?2",
        params![id, content, now()],
    )
    .map(|_| ())
    .map_err(err)
}

pub fn set_pinned_inner(c: &Connection, id: &str, pinned: bool) -> Result<(), String> {
    c.execute(
        "UPDATE notes SET pinned=?2 WHERE id=?1 AND deleted_at IS NULL",
        params![id, pinned as i32],
    )
    .map(|_| ())
    .map_err(err)
}

pub fn delete_inner(c: &Connection, id: &str) -> Result<(), String> {
    c.execute("UPDATE notes SET deleted_at=?2 WHERE id=?1", params![id, now()])
        .map(|_| ())
        .map_err(err)
}

/// Memindahkan catatan tidak mengubah tanggal/jam catatan.
pub fn move_inner(c: &Connection, id: &str, folder: Option<&str>) -> Result<(), String> {
    if let Some(f) = folder {
        if !folder_exists(c, f)? {
            return Err("Folder tidak ditemukan".into());
        }
    }
    c.execute(
        "UPDATE notes SET folder_id=?2 WHERE id=?1 AND deleted_at IS NULL",
        params![id, folder],
    )
    .map(|_| ())
    .map_err(err)
}

// ---------- Folder ----------

fn clean_name(name: &str) -> Result<String, String> {
    let n = name.trim();
    if n.is_empty() {
        return Err("Nama folder tidak boleh kosong".into());
    }
    if n.chars().count() > 50 {
        return Err("Nama folder maksimal 50 karakter".into());
    }
    Ok(n.to_string())
}

fn name_taken(c: &Connection, name: &str, except: Option<&str>) -> Result<bool, String> {
    let n: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM note_folders
             WHERE deleted_at IS NULL AND lower(name)=lower(?1) AND id IS NOT ?2",
            params![name, except],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(n > 0)
}

pub fn folders_inner(c: &Connection) -> Result<FolderList, String> {
    let mut st = c
        .prepare(&format!(
            "SELECT f.id, f.name,
               (SELECT COUNT(*) FROM notes n WHERE n.folder_id = f.id AND n.deleted_at IS NULL AND NOT ({EMPTY}))
             FROM note_folders f WHERE f.deleted_at IS NULL ORDER BY lower(f.name)"
        ))
        .map_err(err)?;
    let folders = st
        .query_map([], |r| Ok(Folder { id: r.get(0)?, name: r.get(1)?, count: r.get(2)? }))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    let total: i64 = c
        .query_row(
            &format!("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND NOT ({EMPTY})"),
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    let unfiled: i64 = c
        .query_row(
            &format!("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND folder_id IS NULL AND NOT ({EMPTY})"),
            [],
            |r| r.get(0),
        )
        .map_err(err)?;
    Ok(FolderList { folders, total, unfiled })
}

pub fn create_folder_inner(c: &Connection, name: &str) -> Result<Folder, String> {
    let name = clean_name(name)?;
    if name_taken(c, &name, None)? {
        return Err("Folder dengan nama itu sudah ada".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO note_folders(id,name,created_at) VALUES(?1,?2,?3)",
        params![id, name, now()],
    )
    .map_err(err)?;
    Ok(Folder { id, name, count: 0 })
}

pub fn rename_folder_inner(c: &Connection, id: &str, name: &str) -> Result<(), String> {
    let name = clean_name(name)?;
    if !folder_exists(c, id)? {
        return Err("Folder tidak ditemukan".into());
    }
    if name_taken(c, &name, Some(id))? {
        return Err("Folder dengan nama itu sudah ada".into());
    }
    c.execute("UPDATE note_folders SET name=?2 WHERE id=?1", params![id, name])
        .map(|_| ())
        .map_err(err)
}

/// Catatan di dalam folder tidak dihapus; dipindahkan ke "Tanpa folder".
pub fn delete_folder_inner(c: &Connection, id: &str) -> Result<(), String> {
    if !folder_exists(c, id)? {
        return Err("Folder tidak ditemukan".into());
    }
    let tx = c.unchecked_transaction().map_err(err)?;
    tx.execute("UPDATE notes SET folder_id=NULL WHERE folder_id=?1", [id]).map_err(err)?;
    tx.execute("UPDATE note_folders SET deleted_at=?2 WHERE id=?1", params![id, now()])
        .map_err(err)?;
    tx.commit().map_err(err)
}

fn unique_folder_name(c: &Connection, base: &str) -> Result<String, String> {
    if !name_taken(c, base, None)? {
        return Ok(base.to_string());
    }
    let mut n = 2;
    loop {
        let candidate = format!("{base} {n}");
        if !name_taken(c, &candidate, None)? {
            return Ok(candidate);
        }
        n += 1;
    }
}

/// Seret catatan `dragged` ke catatan `target`.
/// - target belum punya folder -> dibuat folder baru berisi keduanya.
/// - target sudah di dalam folder -> dragged ikut masuk ke folder itu.
/// Tanggal/jam catatan tidak berubah.
pub fn group_inner(c: &Connection, dragged: &str, target: &str) -> Result<Folder, String> {
    if dragged == target {
        return Err("Pilih dua catatan yang berbeda".into());
    }
    get_inner(c, dragged)?;
    let b = get_inner(c, target)?;
    let tx = c.unchecked_transaction().map_err(err)?;
    let (fid, name) = match b.folder_id {
        Some(f) => {
            let name: String = tx
                .query_row(
                    "SELECT name FROM note_folders WHERE id=?1 AND deleted_at IS NULL",
                    [&f],
                    |r| r.get(0),
                )
                .map_err(err)?;
            (f, name)
        }
        None => {
            let name = unique_folder_name(&tx, "Folder baru")?;
            let id = uuid::Uuid::new_v4().to_string();
            tx.execute(
                "INSERT INTO note_folders(id,name,created_at) VALUES(?1,?2,?3)",
                params![id, name, now()],
            )
            .map_err(err)?;
            (id, name)
        }
    };
    tx.execute("UPDATE notes SET folder_id=?2 WHERE id=?1", params![dragged, fid]).map_err(err)?;
    tx.execute("UPDATE notes SET folder_id=?2 WHERE id=?1", params![target, fid]).map_err(err)?;
    let count: i64 = tx
        .query_row(
            &format!("SELECT COUNT(*) FROM notes WHERE folder_id=?1 AND deleted_at IS NULL AND NOT ({EMPTY})"),
            [&fid],
            |r| r.get(0),
        )
        .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(Folder { id: fid, name, count })
}

// ---------- Tauri commands ----------

#[tauri::command]
pub fn list_notes(db: State<Db>, query: Option<String>, folder: Option<String>) -> Result<Vec<NoteItem>, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    list_inner(&c, query.as_deref().unwrap_or(""), folder.as_deref().unwrap_or("all"))
}

#[tauri::command]
pub fn get_note(db: State<Db>, id: String) -> Result<Note, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    get_inner(&c, &id)
}

#[tauri::command]
pub fn create_note(db: State<Db>, folder_id: Option<String>) -> Result<Note, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    create_inner(&c, folder_id.as_deref())
}

#[tauri::command]
pub fn update_note(db: State<Db>, id: String, content: String) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    update_inner(&c, &id, &content)
}

#[tauri::command]
pub fn set_note_pinned(db: State<Db>, id: String, pinned: bool) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    set_pinned_inner(&c, &id, pinned)
}

#[tauri::command]
pub fn delete_note(db: State<Db>, id: String) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    delete_inner(&c, &id)
}

#[tauri::command]
pub fn move_note(db: State<Db>, id: String, folder_id: Option<String>) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    move_inner(&c, &id, folder_id.as_deref())
}

#[tauri::command]
pub fn list_folders(db: State<Db>) -> Result<FolderList, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    folders_inner(&c)
}

#[tauri::command]
pub fn create_folder(db: State<Db>, name: String) -> Result<Folder, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    create_folder_inner(&c, &name)
}

#[tauri::command]
pub fn rename_folder(db: State<Db>, id: String, name: String) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    rename_folder_inner(&c, &id, &name)
}

#[tauri::command]
pub fn delete_folder(db: State<Db>, id: String) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    delete_folder_inner(&c, &id)
}

#[tauri::command]
pub fn group_notes(db: State<Db>, dragged_id: String, target_id: String) -> Result<Folder, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    group_inner(&c, &dragged_id, &target_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread::sleep, time::Duration};

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        crate::db::ensure_schema(&c).unwrap();
        c
    }
    fn pause() {
        sleep(Duration::from_millis(5));
    }
    fn lines(s: &str) -> Vec<String> {
        plain_text(s).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
    }
    fn all(c: &Connection) -> usize {
        list_inner(c, "", "all").unwrap().len()
    }

    #[test]
    fn plain_text_handles_rich_content() {
        assert_eq!(lines("Judul\nIsi"), vec!["Judul", "Isi"]);
        assert_eq!(lines("<h1>Judul</h1><p>Isi &amp; lain</p>"), vec!["Judul", "Isi & lain"]);
        assert_eq!(lines("<p>A</p><img src=\"data:image/png;base64,AAAA\"><p>B</p>"), vec!["A", "B"]);
        let task = "<ul data-type=\"taskList\"><li data-checked=\"true\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>Beli susu</p></div></li></ul>";
        assert_eq!(lines(task), vec!["Beli susu"]);
        assert_eq!(lines("<table><tr><th><p>Nama</p></th><th><p>Qty</p></th></tr></table>"), vec!["Nama", "Qty"]);
    }

    #[test]
    fn notes_flow() {
        let c = mem();
        let a = create_inner(&c, None).unwrap();
        assert_eq!(all(&c), 0); // kosong tidak tampil

        update_inner(&c, &a.id, "<h1>Judul</h1><p>Isi catatan</p>").unwrap();
        let l = list_inner(&c, "", "all").unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].preview, "Judul\nIsi catatan");
        assert_eq!(list_inner(&c, "ISI", "all").unwrap().len(), 1);
        assert!(list_inner(&c, "tidak ada", "all").unwrap().is_empty());

        let t1 = get_inner(&c, &a.id).unwrap().updated_at;
        pause();
        update_inner(&c, &a.id, "<h1>Judul</h1><p>Isi catatan</p>").unwrap();
        assert_eq!(get_inner(&c, &a.id).unwrap().updated_at, t1);
        pause();
        update_inner(&c, &a.id, "<h1>Judul</h1><p>Isi baru</p>").unwrap();
        assert_ne!(get_inner(&c, &a.id).unwrap().updated_at, t1);

        pause();
        let b = create_inner(&c, None).unwrap();
        update_inner(&c, &b.id, "<p>B</p>").unwrap();
        assert_eq!(list_inner(&c, "", "all").unwrap()[0].id, b.id);
        set_pinned_inner(&c, &a.id, true).unwrap();
        assert_eq!(list_inner(&c, "", "all").unwrap()[0].id, a.id);

        update_inner(&c, &b.id, "<img src=\"data:image/png;base64,AAAA\">").unwrap();
        assert_eq!(
            list_inner(&c, "", "all").unwrap().iter().find(|n| n.id == b.id).unwrap().preview,
            "Gambar"
        );

        update_inner(&c, &b.id, "  \n \t").unwrap();
        assert_eq!(all(&c), 1);

        create_inner(&c, None).unwrap();
        create_inner(&c, None).unwrap();
        let empties: i64 = c
            .query_row(&format!("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND ({EMPTY})"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(empties, 1);

        delete_inner(&c, &a.id).unwrap();
        assert_eq!(all(&c), 0);
    }

    #[test]
    fn folders_flow() {
        let c = mem();
        let work = create_folder_inner(&c, "  Kerja ").unwrap();
        assert_eq!(work.name, "Kerja");
        assert!(create_folder_inner(&c, "kerja").is_err()); // nama sama (tanpa peduli huruf besar)
        assert!(create_folder_inner(&c, "   ").is_err());
        assert!(create_folder_inner(&c, &"x".repeat(51)).is_err());
        let home = create_folder_inner(&c, "Rumah").unwrap();

        let a = create_inner(&c, Some(&work.id)).unwrap();
        update_inner(&c, &a.id, "<p>Rapat</p>").unwrap();
        let b = create_inner(&c, None).unwrap();
        update_inner(&c, &b.id, "<p>Belanja</p>").unwrap();
        let ghost = create_inner(&c, Some("tidak-ada")).unwrap();
        assert!(ghost.folder_id.is_none()); // folder tidak ada: masuk tanpa folder
        update_inner(&c, &ghost.id, "<p>Hantu</p>").unwrap();

        assert_eq!(all(&c), 3);
        assert_eq!(list_inner(&c, "", &work.id).unwrap().len(), 1);
        assert_eq!(list_inner(&c, "", "none").unwrap().len(), 2);
        assert_eq!(list_inner(&c, "rapat", &work.id).unwrap().len(), 1);
        assert!(list_inner(&c, "belanja", &work.id).unwrap().is_empty());
        assert_eq!(list_inner(&c, "rapat", "all").unwrap()[0].folder_name.as_deref(), Some("Kerja"));

        let fl = folders_inner(&c).unwrap();
        assert_eq!((fl.total, fl.unfiled), (3, 2));
        assert_eq!(fl.folders.iter().find(|f| f.id == work.id).unwrap().count, 1);

        // memindahkan catatan tidak mengubah tanggalnya
        let before = get_inner(&c, &b.id).unwrap().updated_at;
        move_inner(&c, &b.id, Some(&home.id)).unwrap();
        assert_eq!(get_inner(&c, &b.id).unwrap().updated_at, before);
        assert_eq!(list_inner(&c, "", &home.id).unwrap().len(), 1);
        assert!(move_inner(&c, &b.id, Some("tidak-ada")).is_err());
        move_inner(&c, &b.id, None).unwrap();

        // ganti nama
        rename_folder_inner(&c, &work.id, "Kantor").unwrap();
        assert!(rename_folder_inner(&c, &work.id, "rumah").is_err());
        rename_folder_inner(&c, &work.id, "KANTOR").unwrap(); // mengubah huruf besar nama sendiri boleh

        // hapus folder: catatan tidak hilang
        delete_folder_inner(&c, &work.id).unwrap();
        assert_eq!(all(&c), 3);
        assert_eq!(list_inner(&c, "", "none").unwrap().len(), 3);
        assert!(create_folder_inner(&c, "Kerja").is_ok());
        assert!(delete_folder_inner(&c, "tidak-ada").is_err());
    }
        #[test]
    fn drag_note_onto_note_creates_or_reuses_folder() {
        let c = mem();
        let mk = |t: &str| {
            let n = create_inner(&c, None).unwrap();
            update_inner(&c, &n.id, t).unwrap();
            n.id
        };
        let (a, b, d) = (mk("<p>A</p>"), mk("<p>B</p>"), mk("<p>D</p>"));

        let f = group_inner(&c, &a, &b).unwrap();
        assert_eq!(f.name, "Folder baru");
        assert_eq!(f.count, 2);
        assert_eq!(get_inner(&c, &a).unwrap().folder_id.as_deref(), Some(f.id.as_str()));

        // target sudah di folder: ikut masuk, tidak membuat folder baru
        let f2 = group_inner(&c, &d, &b).unwrap();
        assert_eq!(f2.id, f.id);
        assert_eq!(f2.count, 3);
        assert_eq!(folders_inner(&c).unwrap().folders.len(), 1);

        // pengelompokan baru berikutnya mendapat nama unik
        let (x, y) = (mk("<p>X</p>"), mk("<p>Y</p>"));
        assert_eq!(group_inner(&c, &x, &y).unwrap().name, "Folder baru 2");
        assert!(group_inner(&c, &x, &x).is_err());
        assert!(group_inner(&c, &x, "tidak-ada").is_err());
    }
}