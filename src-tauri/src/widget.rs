use crate::db::Db;
use rusqlite::{params, OptionalExtension};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

fn get(app: &AppHandle, key: &str) -> Option<String> {
    let db = app.state::<Db>();
    let c = db.0.lock().ok()?;
    c.query_row("SELECT value FROM application_settings WHERE key=?1", [key], |r| r.get::<_, String>(0))
        .optional()
        .ok()
        .flatten()
        .filter(|v| !v.is_empty())
}

fn put(app: &AppHandle, key: &str, val: &str) {
    let db = app.state::<Db>();
    if let Ok(c) = db.0.lock() {
        let _ = c.execute(
            "INSERT INTO application_settings(key,value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
            params![key, val],
        );
    }
}

fn is_pinned(app: &AppHandle) -> bool {
    get(app, "widget_pinned").as_deref() == Some("true")
}

#[tauri::command]
pub fn get_setting(db: State<Db>, key: String) -> Result<Option<String>, String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    c.query_row("SELECT value FROM application_settings WHERE key=?1", [&key], |r| r.get::<_, String>(0))
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_setting(db: State<Db>, key: String, value: String) -> Result<(), String> {
    let c = db.0.lock().map_err(|e| e.to_string())?;
    c.execute(
        "INSERT INTO application_settings(key,value) VALUES(?1,?2)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

fn on_screen(app: &AppHandle, x: i32, y: i32) -> bool {
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let (p, s) = (m.position(), m.size());
        x + 40 >= p.x && x + 40 < p.x + s.width as i32 && y + 20 >= p.y && y + 20 < p.y + s.height as i32
    })
}

fn save_geometry(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        if let (Ok(p), Ok(s)) = (w.outer_position(), w.inner_size()) {
            put(app, "widget_x", &p.x.to_string());
            put(app, "widget_y", &p.y.to_string());
            put(app, "widget_w", &s.width.to_string());
            put(app, "widget_h", &s.height.to_string());
        }
    }
}

pub fn create_widget(app: &AppHandle) -> tauri::Result<()> {
    let win = WebviewWindowBuilder::new(app, "widget", WebviewUrl::App("index.html".into()))
        .title("Todly Widget")
        .inner_size(340.0, 520.0)
        .min_inner_size(260.0, 320.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(is_pinned(app))
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .build()?;

    let sw = get(app, "widget_w").and_then(|v| v.parse::<u32>().ok());
    let sh = get(app, "widget_h").and_then(|v| v.parse::<u32>().ok());
    if let (Some(w), Some(h)) = (sw, sh) {
        win.set_size(PhysicalSize::new(w.clamp(260, 1400), h.clamp(320, 2000)))?;
    }

    let sx = get(app, "widget_x").and_then(|v| v.parse::<i32>().ok());
    let sy = get(app, "widget_y").and_then(|v| v.parse::<i32>().ok());
    match (sx, sy) {
        (Some(x), Some(y)) if on_screen(app, x, y) => win.set_position(PhysicalPosition::new(x, y))?,
        _ => {
            if let Ok(Some(m)) = app.primary_monitor() {
                let ws = win.outer_size()?;
                let x = m.position().x + m.size().width as i32 - ws.width as i32 - 24;
                win.set_position(PhysicalPosition::new(x, m.position().y + 48))?;
            }
        }
    }

    if get(app, "widget_visible").as_deref() != Some("false") {
        win.show()?;
    }
    Ok(())
}

pub fn toggle_widget(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        if w.is_visible().unwrap_or(false) {
            save_geometry(app);
            let _ = w.hide();
            put(app, "widget_visible", "false");
        } else {
            let _ = w.show();
            let _ = w.set_always_on_top(is_pinned(app));
            put(app, "widget_visible", "true");
        }
    }
}

/// Bawa widget ke depan (berguna kalau tertutup jendela lain).
pub fn raise_widget(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        put(app, "widget_visible", "true");
    }
}

pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[tauri::command]
pub fn widget_toggle(app: AppHandle) {
    toggle_widget(&app);
}

#[tauri::command]
pub fn open_main_window(app: AppHandle) {
    show_main(&app);
}

/// Geser widget: dipanggil saat tombol mouse ditekan di bagian atas widget.
#[tauri::command]
pub fn widget_drag(window: tauri::WebviewWindow) {
    let _ = window.start_dragging();
}

/// pinned = selalu di atas jendela lain; false = jendela biasa.
#[tauri::command]
pub fn widget_set_pinned(app: AppHandle, pinned: bool) {
    if let Some(w) = app.get_webview_window("widget") {
        let _ = w.set_always_on_top(pinned);
    }
    put(&app, "widget_pinned", if pinned { "true" } else { "false" });
}

pub fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Buka Todly", true, None::<&str>)?;
    let tog = MenuItem::with_id(app, "widget", "Tampilkan / sembunyikan widget", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &tog, &quit])?;

    let mut b = TrayIconBuilder::new()
        .tooltip("Todly")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id.as_ref() {
            "open" => show_main(app),
            "widget" => toggle_widget(app),
            "quit" => {
                save_geometry(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                raise_widget(tray.app_handle());
            }
        });
    // Ikon tray khusus (icons/tray.png). Jika gagal dibaca, pakai ikon aplikasi.
    let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
        .ok()
        .or_else(|| app.default_window_icon().cloned());
    if let Some(icon) = tray_icon {
        b = b.icon(icon);
    }
    b.build(app)?;
    Ok(())
}