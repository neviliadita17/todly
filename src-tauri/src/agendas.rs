use crate::db::Db;
use chrono::{DateTime, Duration, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const COLS: &str = "id,title,description,start_at,end_at,all_day,location,category,\
sync_status,google_event_id,created_at,updated_at";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Agenda {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub start_at: String,
    pub end_at: String,
    pub all_day: bool,
    pub location: Option<String>,
    pub category: String,
    pub reminder_minutes: Option<i64>,
    pub sync_status: String,
    pub google_event_id: Option<String>,
    pub task_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgendaInput {
    pub title: String,
    pub description: Option<String>,
    pub start_at: String,
    pub end_at: String,
    pub all_day: Option<bool>,
    pub location: Option<String>,
    pub category: Option<String>,
    pub reminder_minutes: Option<i64>,
    pub task_ids: Option<Vec<String>>,
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn row_to_agenda(r: &Row) -> rusqlite::Result<Agenda> {
    Ok(Agenda {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        start_at: r.get(3)?,
        end_at: r.get(4)?,
        all_day: r.get::<_, i64>(5)? != 0,
        location: r.get(6)?,
        category: r.get(7)?,
        sync_status: r.get(8)?,
        google_event_id: r.get(9)?,
        created_at: r.get(10)?,
        updated_at: r.get(11)?,
        reminder_minutes: None,
        task_ids: vec![],
    })
}

fn hydrate(c: &Connection, a: &mut Agenda) -> Result<(), String> {
    let id = a.id.clone();
    let mut st = c
        .prepare(
            "SELECT r.task_id FROM agenda_task_relations r JOIN tasks t ON t.id=r.task_id
             WHERE r.agenda_id=?1 AND t.deleted_at IS NULL ORDER BY r.created_at",
        )
        .map_err(err)?;
    a.task_ids = st
        .query_map([&id], |r| r.get::<_, String>(0))
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    a.reminder_minutes = c
        .query_row(
            "SELECT offset_minutes FROM reminders WHERE target_type='agenda' AND target_id=?1 LIMIT 1",
            [&id],
            |r| r.get(0),
        )
        .optional()
        .map_err(err)?;
    Ok(())
}

fn validate(i: &AgendaInput) -> Result<(String, String), String> {
    let title = i.title.trim().to_string();
    if title.is_empty() {
        return Err("Judul agenda tidak boleh kosong".into());
    }
    if i.end_at < i.start_at {
        return Err("Waktu selesai tidak boleh sebelum waktu mulai".into());
    }
    let cat = i.category.clone().unwrap_or_else(|| "other".into());
    if !["meeting", "appointment", "personal", "office", "reminder", "other"].contains(&cat.as_str()) {
        return Err("Kategori tidak valid".into());
    }
    Ok((title, cat))
}

/// Simpan relasi task & reminder. Reminder yang sudah terkirim tidak dikirim ulang
/// kecuali waktunya berubah.
fn save_links_and_reminder(c: &Connection, id: &str, i: &AgendaInput) -> Result<(), String> {
    c.execute("DELETE FROM agenda_task_relations WHERE agenda_id=?1", [id]).map_err(err)?;
    for t in i.task_ids.clone().unwrap_or_default() {
        c.execute(
            "INSERT OR IGNORE INTO agenda_task_relations(agenda_id,task_id) VALUES(?1,?2)",
            params![id, t],
        )
        .map_err(err)?;
    }
    c.execute(
        "DELETE FROM reminders WHERE target_type='agenda' AND target_id=?1 AND offset_minutes IS NOT ?2",
        params![id, i.reminder_minutes],
    )
    .map_err(err)?;
    if let Some(m) = i.reminder_minutes {
        let start = DateTime::parse_from_rfc3339(&i.start_at)
            .map_err(|_| "Format waktu mulai tidak valid".to_string())?
            .with_timezone(&Utc);
        let at = (start - Duration::minutes(m)).to_rfc3339_opts(SecondsFormat::Millis, true);
        c.execute(
            "INSERT INTO reminders(id,target_type,target_id,offset_minutes,remind_at) VALUES(?1,'agenda',?2,?3,?4)
             ON CONFLICT(target_type,target_id,offset_minutes) DO UPDATE SET
               remind_at=excluded.remind_at,
               fired_at=CASE WHEN reminders.remind_at=excluded.remind_at THEN reminders.fired_at ELSE NULL END",
            params![uuid::Uuid::new_v4().to_string(), id, m, at],
        )
        .map_err(err)?;
    }
    Ok(())
}

fn log(c: &Connection, id: &str, action: &str, summary: &str) -> Result<(), String> {
    c.execute(
        "INSERT INTO activity_log(entity_type,entity_id,action,summary) VALUES('agenda',?1,?2,?3)",
        params![id, action, summary],
    )
    .map_err(err)?;
    Ok(())
}

pub fn get_inner(c: &Connection, id: &str) -> Result<Agenda, String> {
    let mut a = c
        .query_row(
            &format!("SELECT {COLS} FROM agendas WHERE id=?1 AND deleted_at IS NULL"),
            [id],
            row_to_agenda,
        )
        .map_err(|_| "Agenda tidak ditemukan".to_string())?;
    hydrate(c, &mut a)?;
    Ok(a)
}

pub fn list_inner(c: &Connection) -> Result<Vec<Agenda>, String> {
    let mut st = c
        .prepare(&format!("SELECT {COLS} FROM agendas WHERE deleted_at IS NULL ORDER BY start_at"))
        .map_err(err)?;
    let mut v = st
        .query_map([], row_to_agenda)
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    for a in v.iter_mut() {
        hydrate(c, a)?;
    }
    Ok(v)
}

pub fn create_inner(c: &Connection, i: &AgendaInput) -> Result<Agenda, String> {
    let (title, cat) = validate(i)?;
    let id = uuid::Uuid::new_v4().to_string();
    let t = now();
    let tx = c.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO agendas(id,title,description,start_at,end_at,all_day,location,category,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![id, title, i.description, i.start_at, i.end_at, i.all_day.unwrap_or(false) as i32, i.location, cat, t],
    )
    .map_err(err)?;
    save_links_and_reminder(&tx, &id, i)?;
    log(&tx, &id, "created", &title)?;
    tx.commit().map_err(err)?;
    get_inner(c, &id)
}

pub fn update_inner(c: &Connection, id: &str, i: &AgendaInput) -> Result<Agenda, String> {
    let (title, cat) = validate(i)?;
    let tx = c.unchecked_transaction().map_err(err)?;
    // Jika sudah terhubung ke Google, tandai perlu dikirim ulang (kecuali sedang konflik).
    let n = tx
        .execute(
            "UPDATE agendas SET title=?2,description=?3,start_at=?4,end_at=?5,all_day=?6,location=?7,category=?8,
             sync_status=CASE WHEN sync_status='conflict' THEN 'conflict'
                              WHEN google_event_id IS NOT NULL THEN 'pending_push' ELSE sync_status END,
             updated_at=?9 WHERE id=?1 AND deleted_at IS NULL",
            params![id, title, i.description, i.start_at, i.end_at, i.all_day.unwrap_or(false) as i32, i.location, cat, now()],
        )
        .map_err(err)?;
    if n == 0 {
        return Err("Agenda tidak ditemukan".into());
    }
    save_links_and_reminder(&tx, id, i)?;
    log(&tx, id, "edited", &title)?;
    tx.commit().map_err(err)?;
    get_inner(c, id)
}

pub fn delete_inner(c: &Connection, id: &str) -> Result<(), String> {
    let cur = get_inner(c, id)?;
    let tx = c.unchecked_transaction().map_err(err)?;
    // Agenda yang sudah ada di Google ditandai pending_delete agar sync bisa menghapusnya di sana.
    tx.execute(
        "UPDATE agendas SET deleted_at=?2,updated_at=?2,
         sync_status=CASE WHEN google_event_id IS NOT NULL THEN 'pending_delete' ELSE sync_status END WHERE id=?1",
        params![id, now()],
    )
    .map_err(err)?;
    tx.execute("DELETE FROM reminders WHERE target_type='agenda' AND target_id=?1", [id]).map_err(err)?;
    log(&tx, id, "deleted", &cur.title)?;
    tx.commit().map_err(err)
}

#[tauri::command]
pub fn list_agendas(db: State<Db>) -> Result<Vec<Agenda>, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    list_inner(&c)
}

#[tauri::command]
pub fn create_agenda(app: AppHandle, db: State<Db>, input: AgendaInput) -> Result<Agenda, String> {
    let r = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        create_inner(&c, &input)?
    };
    let _ = app.emit("data-changed", ());
    Ok(r)
}

#[tauri::command]
pub fn update_agenda(app: AppHandle, db: State<Db>, id: String, input: AgendaInput) -> Result<Agenda, String> {
    let r = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        update_inner(&c, &id, &input)?
    };
    let _ = app.emit("data-changed", ());
    Ok(r)
}

#[tauri::command]
pub fn delete_agenda(app: AppHandle, db: State<Db>, id: String) -> Result<(), String> {
    {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        delete_inner(&c, &id)?;
    }
    let _ = app.emit("data-changed", ());
    Ok(())
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
    fn inp(title: &str) -> AgendaInput {
        AgendaInput {
            title: title.into(),
            description: None,
            start_at: "2026-11-20T02:00:00.000Z".into(),
            end_at: "2026-11-20T03:00:00.000Z".into(),
            all_day: None,
            location: None,
            category: Some("meeting".into()),
            reminder_minutes: None,
            task_ids: None,
        }
    }
    fn task(c: &Connection) -> String {
        tasks::create_inner(c, &TaskInput {
            title: "T".into(), description: None, priority: None, category_id: None,
            planned_start: None, due_at: None, notes: None,
        }).unwrap().id
    }
    fn n(c: &Connection, sql: &str) -> i64 {
        c.query_row(sql, [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn create_links_tasks_and_reminder() {
        let c = mem();
        let (t1, t2) = (task(&c), task(&c));
        let mut i = inp("Rapat");
        i.task_ids = Some(vec![t1.clone(), t2.clone()]);
        i.reminder_minutes = Some(30);
        let a = create_inner(&c, &i).unwrap();
        assert_eq!(a.task_ids.len(), 2);
        assert_eq!(a.reminder_minutes, Some(30));
        let at: String = c.query_row("SELECT remind_at FROM reminders", [], |r| r.get(0)).unwrap();
        assert_eq!(at, "2026-11-20T01:30:00.000Z");
    }

    #[test]
    fn rejects_bad_input_and_unknown_task() {
        let c = mem();
        assert!(create_inner(&c, &inp("  ")).is_err());
        let mut i = inp("X");
        i.end_at = "2026-11-19T00:00:00.000Z".into();
        assert!(create_inner(&c, &i).is_err());
        let mut j = inp("Y");
        j.task_ids = Some(vec!["tidak-ada".into()]);
        assert!(create_inner(&c, &j).is_err());
        assert_eq!(n(&c, "SELECT COUNT(*) FROM agendas"), 0); // transaksi di-rollback
    }

    #[test]
    fn update_replaces_links_and_keeps_one_reminder() {
        let c = mem();
        let mut i = inp("A");
        i.task_ids = Some(vec![task(&c)]);
        i.reminder_minutes = Some(30);
        let a = create_inner(&c, &i).unwrap();
        i.task_ids = None;
        i.reminder_minutes = Some(10);
        let a = update_inner(&c, &a.id, &i).unwrap();
        assert!(a.task_ids.is_empty());
        assert_eq!(a.reminder_minutes, Some(10));
        assert_eq!(n(&c, "SELECT COUNT(*) FROM reminders"), 1);
    }

    #[test]
    fn google_linked_agenda_marks_pending_states() {
        let c = mem();
        let a = create_inner(&c, &inp("G")).unwrap();
        c.execute("UPDATE agendas SET google_event_id='ev1',sync_status='synced'", []).unwrap();
        let a2 = update_inner(&c, &a.id, &inp("G2")).unwrap();
        assert_eq!(a2.sync_status, "pending_push");
        delete_inner(&c, &a.id).unwrap();
        assert!(list_inner(&c).unwrap().is_empty());
        let s: String = c.query_row("SELECT sync_status FROM agendas", [], |r| r.get(0)).unwrap();
        assert_eq!(s, "pending_delete");
    }
}