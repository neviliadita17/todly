mod agendas;
mod backup;
mod db;
mod history;
mod reminders;
mod tasks;
mod widget;
mod notes;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            let database = db::init(app.handle())?;
            app.manage(database);
            backup::auto_backup(app.handle());
            widget::setup_tray(app.handle())?;
            widget::create_widget(app.handle())?;
            reminders::start(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            tasks::list_tasks,
            tasks::create_task,
            tasks::update_task,
            tasks::move_task,
            tasks::delete_task,
            tasks::reorder_task,
            tasks::data_stamp,
            agendas::list_agendas,
            agendas::create_agenda,
            agendas::update_agenda,
            agendas::delete_agenda,
            history::history_range,
            history::worked_tasks,
            history::task_timeline,
            reminders::set_task_reminder,
            reminders::get_task_reminder,
            widget::get_setting,
            widget::set_setting,
            widget::widget_toggle,
            widget::open_main_window,
            widget::widget_drag,
            widget::widget_set_pinned,
            backup::open_backup_folder,
            notes::list_notes,
            notes::get_note,
            notes::create_note,
            notes::update_note,
            notes::set_note_pinned,
            notes::delete_note,
            notes::move_note,
            notes::list_folders,
            notes::create_folder,
            notes::rename_folder,
            notes::delete_folder,
            notes::group_notes,
            backup::db_info,
            backup::backup_now,
            backup::backup_db,
            backup::restore_db,
            backup::choose_backup_dir,
            backup::reset_backup_dir,
            backup::open_data_folder,
            backup::open_backup_folder
        ])
        .build(tauri::generate_context!())
        .expect("gagal membangun aplikasi")
        .run(|_app, _event| {
            // macOS: klik ikon Dock membuka kembali jendela utama
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                widget::show_main(_app);
            }
        });
}