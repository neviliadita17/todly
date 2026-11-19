use crate::db::Db;
use chrono::{DateTime, Duration, Local, SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_notification::NotificationExt;

fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

fn iso(d: DateTime<Utc>) -> String {
    d.to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn fmt_local(iso: &str, f: &str) -> String {
    DateTime::parse_from_rfc3339(iso)
        .map(|t| t.with_timezone(&Local).format(f).to_string())
        .unwrap_or_default()
}

pub fn label(m: i64) -> String {
    if m >= 1440 && m % 1440 == 0 {
        format!("{} hari", m / 1440)
    } else if m >= 60 && m % 60 == 0 {
        format!("{} jam", m / 60)
    } else {
        format!("{} menit", m)
    }
}

/// Satu pengingat per task, relatif terhadap deadline. minutes=None menghapusnya.
pub fn set_task_reminder_inner(c: &Connection, task_id: &str, minutes: Option<i64>) -> Result<(), String> {
    let due: Option<String> = c
        .query_row(
            "SELECT due_at FROM tasks WHERE id=?1 AND deleted_at IS NULL",
            [task_id],
            |r| r.get(0),
        )
        .map_err(|_| "Task tidak ditemukan".to_string())?;
    c.execute(
        "DELETE FROM reminders WHERE target_type='task' AND target_id=?1 AND offset_minutes IS NOT ?2",
        params![task_id, minutes],
    )
    .map_err(err)?;
    let Some(m) = minutes else { return Ok(()) };
    let due = due.ok_or("Isi deadline dulu untuk memakai pengingat")?;
    let d = DateTime::parse_from_rfc3339(&due)
        .map_err(|_| "Format deadline tidak valid".to_string())?
        .with_timezone(&Utc);
    let at = iso(d - Duration::minutes(m));
    // Jika waktu pengingat berubah, status "sudah terkirim" direset; jika sama, tidak dikirim ulang.
    c.execute(
        "INSERT INTO reminders(id,target_type,target_id,offset_minutes,remind_at) VALUES(?1,'task',?2,?3,?4)
         ON CONFLICT(target_type,target_id,offset_minutes) DO UPDATE SET
           remind_at=excluded.remind_at,
           fired_at=CASE WHEN reminders.remind_at=excluded.remind_at THEN reminders.fired_at ELSE NULL END",
        params![uuid::Uuid::new_v4().to_string(), task_id, m, at],
    )
    .map_err(err)?;
    Ok(())
}

pub fn get_task_reminder_inner(c: &Connection, task_id: &str) -> Result<Option<i64>, String> {
    c.query_row(
        "SELECT offset_minutes FROM reminders WHERE target_type='task' AND target_id=?1 LIMIT 1",
        [task_id],
        |r| r.get(0),
    )
    .optional()
    .map_err(err)
}

#[tauri::command]
pub fn set_task_reminder(db: State<Db>, task_id: String, minutes: Option<i64>) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    set_task_reminder_inner(&c, &task_id, minutes)
}

#[tauri::command]
pub fn get_task_reminder(db: State<Db>, task_id: String) -> Result<Option<i64>, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    get_task_reminder_inner(&c, &task_id)
}

struct Due {
    id: String,
    kind: String,
    target: String,
    offset: i64,
    remind_at: String,
}

fn compose(c: &Connection, d: &Due) -> Result<Option<(String, String)>, String> {
    if d.kind == "agenda" {
        let row = c
            .query_row(
                "SELECT title,start_at,location FROM agendas WHERE id=?1 AND deleted_at IS NULL",
                [&d.target],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<String>>(2)?)),
            )
            .optional()
            .map_err(err)?;
        Ok(row.map(|(title, start, loc)| {
            let mut body = format!("Mulai pukul {} ({} lagi)", fmt_local(&start, "%H:%M"), label(d.offset));
            if let Some(l) = loc.filter(|l| !l.is_empty()) {
                body.push_str(&format!(" · {}", l));
            }
            (format!("🔔 {}", title), body)
        }))
    } else {
        let row = c
            .query_row(
                "SELECT title,due_at FROM tasks WHERE id=?1 AND deleted_at IS NULL AND status!='completed'",
                [&d.target],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?)),
            )
            .optional()
            .map_err(err)?;
        Ok(row.map(|(title, due)| {
            let when = fmt_local(&due.unwrap_or_default(), "%d/%m %H:%M");
            (format!("⏰ Deadline: {}", title), format!("Jatuh tempo {} ({} lagi)", when, label(d.offset)))
        }))
    }
}

pub fn tick(app: &AppHandle) -> Result<(), String> {
    let db = app.state::<Db>();
    let now = Utc::now();
    let now_s = iso(now);
    let mut to_notify: Vec<(String, String)> = vec![];
    {
        let c = db.0.lock().map_err(|e| e.to_string())?;
        let due: Vec<Due> = {
            let mut st = c
                .prepare(
                    "SELECT id,target_type,target_id,offset_minutes,remind_at FROM reminders
                     WHERE fired_at IS NULL AND dismissed=0 AND remind_at<=?1",
                )
                .map_err(err)?;
            let rows = st
                .query_map([&now_s], |r| {
                    Ok(Due { id: r.get(0)?, kind: r.get(1)?, target: r.get(2)?, offset: r.get(3)?, remind_at: r.get(4)? })
                })
                .map_err(err)?;
            let v = rows.collect::<Result<Vec<_>, _>>().map_err(err)?;
            v
        };
        for d in due {
            // Tandai terkirim LEBIH DAHULU agar tidak pernah muncul dua kali.
            c.execute(
                "UPDATE reminders SET fired_at=?2 WHERE id=?1 AND fired_at IS NULL",
                params![d.id, now_s],
            )
            .map_err(err)?;
            // Pengingat yang terlewat > 12 jam (mis. aplikasi mati) tidak ditampilkan.
            let stale = DateTime::parse_from_rfc3339(&d.remind_at)
                .map(|t| now - t.with_timezone(&Utc) > Duration::hours(12))
                .unwrap_or(true);
            if stale {
                continue;
            }
            if let Some(msg) = compose(&c, &d)? {
                to_notify.push(msg);
            }
        }
    }
    for (title, body) in to_notify {
        let _ = app.notification().builder().title(title).body(body).show();
    }
    Ok(())
}

/// Jalan di thread sendiri; cek setiap 20 detik, hanya membaca baris yang jatuh tempo.
pub fn start(app: &AppHandle) {
    let h = app.clone();
    std::thread::spawn(move || loop {
        let _ = tick(&h);
        std::thread::sleep(std::time::Duration::from_secs(20));
    });
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
    fn mk(c: &Connection, due: Option<&str>) -> String {
        tasks::create_inner(
            c,
            &TaskInput {
                title: "T".into(),
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
    fn one_reminder_relative_to_deadline() {
        let c = mem();
        let id = mk(&c, Some("2026-11-21T03:00:00.000Z"));
        set_task_reminder_inner(&c, &id, Some(60)).unwrap();
        set_task_reminder_inner(&c, &id, Some(1440)).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM reminders", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let at: String = c.query_row("SELECT remind_at FROM reminders", [], |r| r.get(0)).unwrap();
        assert_eq!(at, "2026-11-20T03:00:00.000Z");
        assert_eq!(get_task_reminder_inner(&c, &id).unwrap(), Some(1440));
        set_task_reminder_inner(&c, &id, None).unwrap();
        assert_eq!(get_task_reminder_inner(&c, &id).unwrap(), None);
    }

    #[test]
    fn needs_deadline_and_resets_fired_only_when_time_changes() {
        let c = mem();
        let no_due = mk(&c, None);
        assert!(set_task_reminder_inner(&c, &no_due, Some(30)).is_err());

        let id = mk(&c, Some("2026-11-21T03:00:00.000Z"));
        set_task_reminder_inner(&c, &id, Some(30)).unwrap();
        c.execute("UPDATE reminders SET fired_at='x'", []).unwrap();
        set_task_reminder_inner(&c, &id, Some(30)).unwrap(); // waktu sama: tetap "sudah terkirim"
        let f: Option<String> = c.query_row("SELECT fired_at FROM reminders", [], |r| r.get(0)).unwrap();
        assert!(f.is_some());

        c.execute("UPDATE tasks SET due_at='2026-11-22T03:00:00.000Z' WHERE id=?1", [&id]).unwrap();
        set_task_reminder_inner(&c, &id, Some(30)).unwrap(); // deadline pindah: dikirim lagi
        let f: Option<String> = c.query_row("SELECT fired_at FROM reminders", [], |r| r.get(0)).unwrap();
        assert!(f.is_none());
    }
}