use crate::db::Db;
use rusqlite::{Connection, Row};
use serde::Serialize;
use tauri::State;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEvent {
    pub id: i64,
    pub task_id: String,
    pub title: String,
    pub priority: String,
    pub event: String,
    pub from_status: Option<String>,
    pub to_status: Option<String>,
    pub changed_at: String,
    pub was_late: bool,
    pub due_at: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkedTask {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub priority: String,
    pub category: Option<String>,
    pub planned_start: Option<String>,
    pub due_at: Option<String>,
    pub actual_start: Option<String>,
    pub completed_at: Option<String>,
    pub notes: Option<String>,
    pub created_at: String,
    /// Waktu penyelesaian terakhir DI DALAM periode (None jika tidak selesai di periode ini)
    pub done_at: Option<String>,
    /// Waktu mulai dikerjakan terakhir DI DALAM periode
    pub started_at: Option<String>,
    pub late: bool,
}

fn e(x: rusqlite::Error) -> String {
    x.to_string()
}

fn map_event(r: &Row) -> rusqlite::Result<HistoryEvent> {
    Ok(HistoryEvent {
        id: r.get(0)?,
        task_id: r.get(1)?,
        title: r.get(2)?,
        priority: r.get(3)?,
        event: r.get(4)?,
        from_status: r.get(5)?,
        to_status: r.get(6)?,
        changed_at: r.get(7)?,
        was_late: r.get::<_, i64>(8)? != 0,
        due_at: r.get(9)?,
    })
}

const EVENT_COLS: &str = "h.id, h.task_id, t.title, t.priority, h.event, h.from_status, h.to_status,
                          h.changed_at, h.was_late, t.due_at";

/// Semua kejadian status task dalam rentang [from, to). Task yang dihapus tidak ikut.
pub fn range_inner(c: &Connection, from: &str, to: &str) -> Result<Vec<HistoryEvent>, String> {
    let mut st = c
        .prepare(&format!(
            "SELECT {EVENT_COLS} FROM task_status_history h JOIN tasks t ON t.id = h.task_id
             WHERE t.deleted_at IS NULL AND h.changed_at >= ?1 AND h.changed_at < ?2
               AND h.event IN ('created','status_changed','completed','reopened')
             ORDER BY h.changed_at DESC, h.id DESC"
        ))
        .map_err(e)?;
    let rows = st.query_map([from, to], map_event).map_err(e)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(e)
}

/// Seluruh riwayat satu task, dari yang paling lama.
pub fn timeline_inner(c: &Connection, task_id: &str) -> Result<Vec<HistoryEvent>, String> {
    let mut st = c
        .prepare(&format!(
            "SELECT {EVENT_COLS} FROM task_status_history h JOIN tasks t ON t.id = h.task_id
             WHERE h.task_id = ?1 AND h.event IN ('created','status_changed','completed','reopened')
             ORDER BY h.changed_at ASC, h.id ASC"
        ))
        .map_err(e)?;
    let rows = st.query_map([task_id], map_event).map_err(e)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(e)
}

/// Task yang mulai dikerjakan ATAU diselesaikan dalam rentang [from, to).
pub fn worked_inner(c: &Connection, from: &str, to: &str) -> Result<Vec<WorkedTask>, String> {
    let mut st = c
        .prepare(
            "SELECT * FROM (
               SELECT t.id, t.title, t.description, t.status, t.priority, c.name,
                      t.planned_start, t.due_at, t.actual_start, t.completed_at, t.notes, t.created_at,
                 (SELECT MAX(h.changed_at) FROM task_status_history h
                    WHERE h.task_id = t.id AND h.event = 'completed'
                      AND h.changed_at >= ?1 AND h.changed_at < ?2) AS done_at,
                 (SELECT MAX(h.changed_at) FROM task_status_history h
                    WHERE h.task_id = t.id AND h.event = 'status_changed' AND h.to_status = 'in_progress'
                      AND h.changed_at >= ?1 AND h.changed_at < ?2) AS started_at,
                 COALESCE((SELECT h.was_late FROM task_status_history h
                    WHERE h.task_id = t.id AND h.event = 'completed'
                      AND h.changed_at >= ?1 AND h.changed_at < ?2
                    ORDER BY h.changed_at DESC, h.id DESC LIMIT 1), 0) AS late
               FROM tasks t LEFT JOIN task_categories c ON c.id = t.category_id
               WHERE t.deleted_at IS NULL
             ) WHERE done_at IS NOT NULL OR started_at IS NOT NULL
             ORDER BY COALESCE(done_at, started_at) DESC",
        )
        .map_err(e)?;
    let rows = st
        .query_map([from, to], |r| {
            Ok(WorkedTask {
                id: r.get(0)?,
                title: r.get(1)?,
                description: r.get(2)?,
                status: r.get(3)?,
                priority: r.get(4)?,
                category: r.get(5)?,
                planned_start: r.get(6)?,
                due_at: r.get(7)?,
                actual_start: r.get(8)?,
                completed_at: r.get(9)?,
                notes: r.get(10)?,
                created_at: r.get(11)?,
                done_at: r.get(12)?,
                started_at: r.get(13)?,
                late: r.get::<_, i64>(14)? != 0,
            })
        })
        .map_err(e)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(e)
}

#[tauri::command]
pub fn history_range(db: State<Db>, from: String, to: String) -> Result<Vec<HistoryEvent>, String> {
    let c = db.0.lock().map_err(|x| x.to_string())?;
    range_inner(&c, &from, &to)
}

#[tauri::command]
pub fn worked_tasks(db: State<Db>, from: String, to: String) -> Result<Vec<WorkedTask>, String> {
    let c = db.0.lock().map_err(|x| x.to_string())?;
    worked_inner(&c, &from, &to)
}

#[tauri::command]
pub fn task_timeline(db: State<Db>, task_id: String) -> Result<Vec<HistoryEvent>, String> {
    let c = db.0.lock().map_err(|x| x.to_string())?;
    timeline_inner(&c, &task_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tasks::{self, TaskInput};

    const FROM: &str = "2000-01-01T00:00:00.000Z";
    const TO: &str = "2999-01-01T00:00:00.000Z";

    fn mem() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        c.execute_batch(include_str!("../migrations/001_init.sql")).unwrap();
        c
    }
    fn mk(c: &Connection, title: &str, due: Option<&str>) -> String {
        tasks::create_inner(
            c,
            &TaskInput {
                title: title.into(),
                description: None,
                priority: None,
                category_id: None,
                planned_start: None,
                due_at: due.map(String::from),
                notes: None,
            },
        )
        .unwrap()
        .id
    }

    #[test]
    fn lists_events_in_range_and_hides_deleted() {
        let c = mem();
        let id = mk(&c, "A", Some("2000-01-01T00:00:00.000Z"));
        tasks::move_inner(&c, &id, "completed").unwrap();
        let all = range_inner(&c, FROM, TO).unwrap();
        assert!(all.iter().any(|x| x.event == "completed" && x.was_late && x.title == "A"));
        assert!(range_inner(&c, FROM, "2001-01-01T00:00:00.000Z").unwrap().is_empty());
        tasks::delete_inner(&c, &id).unwrap();
        assert!(range_inner(&c, FROM, TO).unwrap().is_empty());
    }

    #[test]
    fn worked_tasks_per_period_and_timeline() {
        let c = mem();
        let id = mk(&c, "A", Some("2000-01-01T00:00:00.000Z"));
        tasks::move_inner(&c, &id, "in_progress").unwrap();
        tasks::move_inner(&c, &id, "completed").unwrap();
        mk(&c, "B", None); // tidak pernah dikerjakan: tidak boleh muncul

        let w = worked_inner(&c, FROM, TO).unwrap();
        assert_eq!(w.len(), 1);
        assert_eq!(w[0].title, "A");
        assert!(w[0].done_at.is_some() && w[0].started_at.is_some() && w[0].late);
        // periode lain kosong
        assert!(worked_inner(&c, FROM, "2001-01-01T00:00:00.000Z").unwrap().is_empty());

        let tl = timeline_inner(&c, &id).unwrap();
        let ev: Vec<&str> = tl.iter().map(|x| x.event.as_str()).collect();
        assert_eq!(ev, vec!["created", "status_changed", "completed"]);

        // dibuka kembali: tetap tercatat pernah selesai, status sekarang todo
        tasks::move_inner(&c, &id, "todo").unwrap();
        let w = worked_inner(&c, FROM, TO).unwrap();
        assert_eq!(w[0].status, "todo");
        assert!(w[0].done_at.is_some());

        // task yang dihapus tidak tampil
        tasks::delete_inner(&c, &id).unwrap();
        assert!(worked_inner(&c, FROM, TO).unwrap().is_empty());
    }
}