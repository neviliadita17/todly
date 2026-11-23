use crate::db::Db;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, Row};
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub content: String,
    pub pinned: bool,
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
    pub created_at: String,
    pub updated_at: String,
}

const COLS: &str = "id,content,pinned,created_at,updated_at";
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
        created_at: r.get(3)?,
        updated_at: r.get(4)?,
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
                tag.push(ch); // cukup awal tag; atribut panjang (data gambar) dilewati
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

/// Daftar catatan (kosong disembunyikan). `query` mencari di seluruh teks catatan.
pub fn list_inner(c: &Connection, query: &str) -> Result<Vec<NoteItem>, String> {
    let mut st = c
        .prepare(&format!(
            "SELECT {COLS} FROM notes WHERE deleted_at IS NULL AND NOT ({EMPTY})
             ORDER BY pinned DESC, updated_at DESC"
        ))
        .map_err(err)?;
    let q = query.trim().to_lowercase();
    let rows = st
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })
        .map_err(err)?;
    let mut out = vec![];
    for r in rows {
        let (id, content, pinned, created_at, updated_at) = r.map_err(err)?;
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
        out.push(NoteItem { id, preview, pinned: pinned != 0, created_at, updated_at });
    }
    Ok(out)
}

pub fn create_inner(c: &Connection) -> Result<Note, String> {
    let t = now();
    c.execute(
        &format!("UPDATE notes SET deleted_at=?1 WHERE deleted_at IS NULL AND ({EMPTY})"),
        [&t],
    )
    .map_err(err)?;
    let id = uuid::Uuid::new_v4().to_string();
    c.execute(
        "INSERT INTO notes(id,content,created_at,updated_at) VALUES(?1,'',?2,?2)",
        params![id, t],
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

#[tauri::command]
pub fn list_notes(db: State<Db>, query: Option<String>) -> Result<Vec<NoteItem>, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    list_inner(&c, query.as_deref().unwrap_or(""))
}

#[tauri::command]
pub fn get_note(db: State<Db>, id: String) -> Result<Note, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    get_inner(&c, &id)
}

#[tauri::command]
pub fn create_note(db: State<Db>) -> Result<Note, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    create_inner(&c)
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{thread::sleep, time::Duration};

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../migrations/001_init.sql")).unwrap();
        c
    }
    fn pause() {
        sleep(Duration::from_millis(5));
    }
    fn lines(s: &str) -> Vec<String> {
        plain_text(s).lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect()
    }

    #[test]
    fn plain_text_handles_rich_content() {
        assert_eq!(lines("Judul\nIsi"), vec!["Judul", "Isi"]); // catatan lama
        assert_eq!(lines("<h1>Judul</h1><p>Isi &amp; lain</p>"), vec!["Judul", "Isi & lain"]);
        assert_eq!(lines("<p>A</p><img src=\"data:image/png;base64,AAAA\"><p>B</p>"), vec!["A", "B"]);
        let task = "<ul data-type=\"taskList\"><li data-checked=\"true\"><label><input type=\"checkbox\" checked=\"checked\"><span></span></label><div><p>Beli susu</p></div></li></ul>";
        assert_eq!(lines(task), vec!["Beli susu"]);
        assert_eq!(lines("<table><tr><th><p>Nama</p></th><th><p>Qty</p></th></tr></table>"), vec!["Nama", "Qty"]);
    }

    #[test]
    fn notes_flow() {
        let c = mem();
        let a = create_inner(&c).unwrap();
        assert!(list_inner(&c, "").unwrap().is_empty()); // kosong tidak tampil

        update_inner(&c, &a.id, "<h1>Judul</h1><p>Isi catatan</p>").unwrap();
        let l = list_inner(&c, "").unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].preview, "Judul\nIsi catatan");
        assert_eq!(list_inner(&c, "ISI").unwrap().len(), 1); // pencarian tanpa peduli huruf besar
        assert!(list_inner(&c, "tidak ada").unwrap().is_empty());

        // isi sama: tanggal tidak berubah; isi beda: berubah
        let t1 = get_inner(&c, &a.id).unwrap().updated_at;
        pause();
        update_inner(&c, &a.id, "<h1>Judul</h1><p>Isi catatan</p>").unwrap();
        assert_eq!(get_inner(&c, &a.id).unwrap().updated_at, t1);
        pause();
        update_inner(&c, &a.id, "<h1>Judul</h1><p>Isi baru</p>").unwrap();
        assert_ne!(get_inner(&c, &a.id).unwrap().updated_at, t1);

        // catatan terbaru di atas, kecuali yang disematkan
        pause();
        let b = create_inner(&c).unwrap();
        update_inner(&c, &b.id, "<p>B</p>").unwrap();
        assert_eq!(list_inner(&c, "").unwrap()[0].id, b.id);
        set_pinned_inner(&c, &a.id, true).unwrap();
        assert_eq!(list_inner(&c, "").unwrap()[0].id, a.id);

        // catatan hanya berisi gambar tetap tampil
        update_inner(&c, &b.id, "<img src=\"data:image/png;base64,AAAA\">").unwrap();
        assert_eq!(list_inner(&c, "").unwrap().iter().find(|n| n.id == b.id).unwrap().preview, "Gambar");

        // spasi/baris baru saja dianggap kosong
        update_inner(&c, &b.id, "  \n \t").unwrap();
        assert_eq!(list_inner(&c, "").unwrap().len(), 1);

        // membuat catatan baru membuang catatan kosong lama
        create_inner(&c).unwrap();
        create_inner(&c).unwrap();
        let empties: i64 = c
            .query_row(&format!("SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL AND ({EMPTY})"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(empties, 1);

        delete_inner(&c, &a.id).unwrap();
        assert!(list_inner(&c, "").unwrap().is_empty());
    }
}