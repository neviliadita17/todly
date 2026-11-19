use crate::db::Db;
use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, Row};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

const COLS: &str = "id,title,description,status,priority,category_id,planned_start,due_at,\
actual_start,completed_at,notes,sort_order,google_event_id,created_at,updated_at";

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub category_id: Option<String>,
    pub planned_start: Option<String>,
    pub due_at: Option<String>,
    pub actual_start: Option<String>,
    pub completed_at: Option<String>,
    pub notes: Option<String>,
    pub sort_order: f64,
    pub google_event_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub title: String,
    pub description: Option<String>,
    pub priority: Option<String>,
    pub category_id: Option<String>,
    pub planned_start: Option<String>,
    pub due_at: Option<String>,
    pub notes: Option<String>,
}

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn row_to_task(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get(0)?,
        title: r.get(1)?,
        description: r.get(2)?,
        status: r.get(3)?,
        priority: r.get(4)?,
        category_id: r.get(5)?,
        planned_start: r.get(6)?,
        due_at: r.get(7)?,
        actual_start: r.get(8)?,
        completed_at: r.get(9)?,
        notes: r.get(10)?,
        sort_order: r.get(11)?,
        google_event_id: r.get(12)?,
        created_at: r.get(13)?,
        updated_at: r.get(14)?,
    })
}

fn log(
    c: &Connection,
    task_id: &str,
    event: &str,
    from: Option<&str>,
    to: Option<&str>,
    late: bool,
    summary: &str,
) -> Result<(), String> {
    c.execute(
        "INSERT INTO task_status_history(task_id,event,from_status,to_status,was_late) VALUES(?1,?2,?3,?4,?5)",
        params![task_id, event, from, to, late as i32],
    )
    .map_err(err)?;
    c.execute(
        "INSERT INTO activity_log(entity_type,entity_id,action,summary) VALUES('task',?1,?2,?3)",
        params![task_id, event, summary],
    )
    .map_err(err)?;
    Ok(())
}

pub fn get_inner(c: &Connection, id: &str) -> Result<Task, String> {
    c.query_row(
        &format!("SELECT {COLS} FROM tasks WHERE id=?1 AND deleted_at IS NULL"),
        [id],
        row_to_task,
    )
    .map_err(|_| "Task tidak ditemukan".to_string())
}

pub fn list_inner(c: &Connection) -> Result<Vec<Task>, String> {
    let mut st = c
        .prepare(&format!(
            "SELECT {COLS} FROM tasks WHERE deleted_at IS NULL ORDER BY sort_order, created_at DESC"
        ))
        .map_err(err)?;
    let rows = st.query_map([], row_to_task).map_err(err)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(err)
}

pub fn create_inner(c: &Connection, i: &TaskInput) -> Result<Task, String> {
    let title = i.title.trim();
    if title.is_empty() {
        return Err("Judul tidak boleh kosong".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let t = now();
    let tx = c.unchecked_transaction().map_err(err)?;
    tx.execute(
        "INSERT INTO tasks(id,title,description,priority,category_id,planned_start,due_at,notes,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)",
        params![
            id,
            title,
            i.description,
            i.priority.clone().unwrap_or_else(|| "medium".into()),
            i.category_id,
            i.planned_start,
            i.due_at,
            i.notes,
            t
        ],
    )
    .map_err(err)?;
    log(&tx, &id, "created", None, Some("todo"), false, title)?;
    tx.commit().map_err(err)?;
    get_inner(c, &id)
}

pub fn update_inner(c: &Connection, id: &str, i: &TaskInput) -> Result<Task, String> {
    let title = i.title.trim();
    if title.is_empty() {
        return Err("Judul tidak boleh kosong".into());
    }
    let tx = c.unchecked_transaction().map_err(err)?;
    let n = tx
        .execute(
            "UPDATE tasks SET title=?2,description=?3,priority=COALESCE(?4,priority),category_id=?5,
             planned_start=?6,due_at=?7,notes=?8,updated_at=?9 WHERE id=?1 AND deleted_at IS NULL",
            params![
                id,
                title,
                i.description,
                i.priority,
                i.category_id,
                i.planned_start,
                i.due_at,
                i.notes,
                now()
            ],
        )
        .map_err(err)?;
    if n == 0 {
        return Err("Task tidak ditemukan".into());
    }
    log(&tx, id, "edited", None, None, false, title)?;
    tx.commit().map_err(err)?;
    get_inner(c, id)
}

pub fn move_inner(c: &Connection, id: &str, to: &str) -> Result<Task, String> {
    if !["todo", "in_progress", "completed"].contains(&to) {
        return Err("Status tidak valid".into());
    }
    let cur = get_inner(c, id)?;
    if cur.status == to {
        return Ok(cur);
    }
    let t = now();
    let late = to == "completed" && cur.due_at.as_deref().map_or(false, |d| d < t.as_str());
    let tx = c.unchecked_transaction().map_err(err)?;
    match to {
        "in_progress" => tx.execute(
            "UPDATE tasks SET status='in_progress',actual_start=COALESCE(actual_start,?2),completed_at=NULL,updated_at=?2 WHERE id=?1",
            params![id, t]),
        "completed" => tx.execute(
            "UPDATE tasks SET status='completed',completed_at=?2,updated_at=?2 WHERE id=?1",
            params![id, t]),
        _ => tx.execute(
            "UPDATE tasks SET status='todo',completed_at=NULL,updated_at=?2 WHERE id=?1",
            params![id, t]),
    }
    .map_err(err)?;
    let event = if cur.status == "completed" {
        "reopened"
    } else if to == "completed" {
        "completed"
    } else {
        "status_changed"
    };
    log(&tx, id, event, Some(&cur.status), Some(to), late, &cur.title)?;
    tx.commit().map_err(err)?;
    get_inner(c, id)
}

pub fn delete_inner(c: &Connection, id: &str) -> Result<(), String> {
    let cur = get_inner(c, id)?;
    let tx = c.unchecked_transaction().map_err(err)?;
    tx.execute("UPDATE tasks SET deleted_at=?2,updated_at=?2 WHERE id=?1", params![id, now()])
        .map_err(err)?;
    log(&tx, id, "deleted", Some(&cur.status), None, false, &cur.title)?;
    tx.commit().map_err(err)
}

pub fn reorder_inner(c: &Connection, id: &str, to: &str, ordered: &[String]) -> Result<Task, String> {
    if !ordered.iter().any(|x| x == id) {
        return Err("Urutan tidak memuat task yang dipindah".into());
    }
    move_inner(c, id, to)?;
    let t = now();
    let tx = c.unchecked_transaction().map_err(err)?;
    for (i, tid) in ordered.iter().enumerate() {
        // updated_at hanya diubah untuk baris yang urutannya benar-benar berubah
        tx.execute(
            "UPDATE tasks SET sort_order=?2, updated_at=?4
             WHERE id=?1 AND status=?3 AND deleted_at IS NULL AND sort_order IS NOT ?2",
            params![tid, i as f64, to, t],
        )
        .map_err(err)?;
    }
    tx.commit().map_err(err)?;
    get_inner(c, id)
}

/// Penanda ringan "data sudah berubah" untuk tasks & agendas (termasuk yang dihapus).
pub fn stamp_inner(c: &Connection) -> Result<String, String> {
    c.query_row(
        "SELECT (SELECT COALESCE(MAX(updated_at),'') || '#' || COUNT(*) FROM tasks)
             || '|' || (SELECT COALESCE(MAX(updated_at),'') || '#' || COUNT(*) FROM agendas)",
        [],
        |r| r.get(0),
    )
    .map_err(err)
}

#[tauri::command]
pub fn list_tasks(db: State<Db>) -> Result<Vec<Task>, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    list_inner(&c)
}

#[tauri::command]
pub fn create_task(app: AppHandle, db: State<Db>, input: TaskInput) -> Result<Task, String> {
    let r = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        create_inner(&c, &input)?
    };
    let _ = app.emit("data-changed", ());
    Ok(r)
}

#[tauri::command]
pub fn update_task(app: AppHandle, db: State<Db>, id: String, input: TaskInput) -> Result<Task, String> {
    let r = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        update_inner(&c, &id, &input)?
    };
    let _ = app.emit("data-changed", ());
    Ok(r)
}

#[tauri::command]
pub fn move_task(app: AppHandle, db: State<Db>, id: String, status: String) -> Result<Task, String> {
    let r = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        move_inner(&c, &id, &status)?
    };
    let _ = app.emit("data-changed", ());
    Ok(r)
}

#[tauri::command]
pub fn delete_task(app: AppHandle, db: State<Db>, id: String) -> Result<(), String> {
    {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        delete_inner(&c, &id)?;
    }
    let _ = app.emit("data-changed", ());
    Ok(())
}

#[tauri::command]
pub fn reorder_task(
    app: AppHandle,
    db: State<Db>,
    id: String,
    status: String,
    ordered_ids: Vec<String>,
) -> Result<Task, String> {
    let r = {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        reorder_inner(&c, &id, &status, &ordered_ids)?
    };
    let _ = app.emit("data-changed", ());
    Ok(r)
}

#[tauri::command]
pub fn data_stamp(db: State<Db>) -> Result<String, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    stamp_inner(&c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../migrations/001_init.sql")).unwrap();
        c
    }
    fn input(title: &str, due: Option<&str>) -> TaskInput {
        TaskInput {
            title: title.into(),
            description: None,
            priority: None,
            category_id: None,
            planned_start: None,
            due_at: due.map(String::from),
            notes: None,
        }
    }
    fn count(c: &Connection, sql: &str, id: &str) -> i64 {
        c.query_row(sql, [id], |r| r.get(0)).unwrap()
    }

    #[test]
    fn status_flow_keeps_history_and_single_row() {
        let c = mem();
        let t = create_inner(&c, &input("A", Some("2000-01-01T00:00:00.000Z"))).unwrap();
        assert_eq!(t.status, "todo");

        let t = move_inner(&c, &t.id, "in_progress").unwrap();
        assert!(t.actual_start.is_some());
        let first_start = t.actual_start.clone();

        let t = move_inner(&c, &t.id, "completed").unwrap();
        assert!(t.completed_at.is_some());

        let t = move_inner(&c, &t.id, "todo").unwrap();
        assert!(t.completed_at.is_none());

        let t = move_inner(&c, &t.id, "in_progress").unwrap();
        assert_eq!(t.actual_start, first_start);

        assert_eq!(count(&c, "SELECT COUNT(*) FROM task_status_history WHERE task_id=?1 AND event='completed' AND was_late=1", &t.id), 1);
        assert_eq!(count(&c, "SELECT COUNT(*) FROM task_status_history WHERE task_id=?1 AND event='reopened'", &t.id), 1);
        assert_eq!(c.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }

    #[test]
    fn rejects_empty_title_and_bad_status() {
        let c = mem();
        assert!(create_inner(&c, &input("   ", None)).is_err());
        let t = create_inner(&c, &input("B", None)).unwrap();
        assert!(move_inner(&c, &t.id, "bogus").is_err());
    }

    #[test]
    fn soft_delete_hides_task_but_keeps_row() {
        let c = mem();
        let t = create_inner(&c, &input("C", None)).unwrap();
        delete_inner(&c, &t.id).unwrap();
        assert!(list_inner(&c).unwrap().is_empty());
        assert_eq!(c.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    }
    
    #[test]
    fn reorder_within_and_across_columns() {
        let c = mem();
        let a = create_inner(&c, &input("A", None)).unwrap();
        let x = create_inner(&c, &input("X", None)).unwrap();

        // pindah X ke In Progress
        reorder_inner(&c, &x.id, "in_progress", &[x.id.clone()]).unwrap();
        // sisipkan A di atas X
        reorder_inner(&c, &a.id, "in_progress", &[a.id.clone(), x.id.clone()]).unwrap();
        let titles = |c: &Connection| -> Vec<String> {
            list_inner(c).unwrap().into_iter()
                .filter(|t| t.status == "in_progress").map(|t| t.title).collect()
        };
        assert_eq!(titles(&c), vec!["A", "X"]);

        // urutkan ulang di kolom yang sama
        reorder_inner(&c, &x.id, "in_progress", &[x.id.clone(), a.id.clone()]).unwrap();
        assert_eq!(titles(&c), vec!["X", "A"]);

        // tidak ada duplikasi task
        assert_eq!(c.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
        // id yang tidak ada dalam urutan ditolak
        assert!(reorder_inner(&c, &a.id, "todo", &[]).is_err());
    }

    #[test]
    fn stamp_changes_on_every_kind_of_change() {
        use std::{thread::sleep, time::Duration};
        let pause = || sleep(Duration::from_millis(5));
        let c = mem();
        let s0 = stamp_inner(&c).unwrap();
        pause();
        let a = create_inner(&c, &input("A", None)).unwrap();
        let b = create_inner(&c, &input("B", None)).unwrap();
        let s1 = stamp_inner(&c).unwrap();
        assert_ne!(s0, s1); // dibuat
        pause();
        reorder_inner(&c, &a.id, "todo", &[a.id.clone(), b.id.clone()]).unwrap();
        let s2 = stamp_inner(&c).unwrap();
        assert_ne!(s1, s2); // hanya urutan berubah
        pause();
        move_inner(&c, &a.id, "completed").unwrap();
        let s3 = stamp_inner(&c).unwrap();
        assert_ne!(s2, s3); // status berubah
        pause();
        delete_inner(&c, &a.id).unwrap();
        assert_ne!(s3, stamp_inner(&c).unwrap()); // dihapus
    }
}