import { invoke } from "@tauri-apps/api/core";

export type Status = "todo" | "in_progress" | "completed";
export type Priority = "low" | "medium" | "high" | "urgent";

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  categoryId: string | null;
  plannedStart: string | null;
  dueAt: string | null;
  actualStart: string | null;
  completedAt: string | null;
  notes: string | null;
  sortOrder: number;
  googleEventId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskInput {
  title: string;
  description?: string | null;
  priority?: Priority;
  categoryId?: string | null;
  plannedStart?: string | null;
  dueAt?: string | null;
  notes?: string | null;
}

export const api = {
  //Task
  listTasks: () => invoke<Task[]>("list_tasks"),
  createTask: (input: TaskInput) => invoke<Task>("create_task", { input }),
  updateTask: (id: string, input: TaskInput) => invoke<Task>("update_task", { id, input }),
  moveTask: (id: string, status: Status) => invoke<Task>("move_task", { id, status }),
  deleteTask: (id: string) => invoke<void>("delete_task", { id }),
  reorderTask: (id: string, status: Status, orderedIds: string[]) => invoke<Task>("reorder_task", { id, status, orderedIds }),
  historyRange: (from: string, to: string) => invoke<HistoryEvent[]>("history_range", { from, to }),

  //Agenda
  listAgendas: () => invoke<Agenda[]>("list_agendas"),
  createAgenda: (input: AgendaInput) => invoke<Agenda>("create_agenda", { input }),
  updateAgenda: (id: string, input: AgendaInput) => invoke<Agenda>("update_agenda", { id, input }),
  deleteAgenda: (id: string) => invoke<void>("delete_agenda", { id }),

  //Reminder
  setTaskReminder: (taskId: string, minutes: number | null) =>
  invoke<void>("set_task_reminder", { taskId, minutes }),
  getTaskReminder: (taskId: string) => invoke<number | null>("get_task_reminder", { taskId }),
  getSetting: (key: string) => invoke<string | null>("get_setting", { key }),
  setSetting: (key: string, value: string) => invoke<void>("set_setting", { key, value }),
  toggleWidget: () => invoke<void>("widget_toggle"),
  openMain: () => invoke<void>("open_main_window"),
  
  //Widget
  widgetDrag: () => invoke<void>("widget_drag"),
  setWidgetPinned: (pinned: boolean) => invoke<void>("widget_set_pinned", { pinned }),

  workedTasks: (from: string, to: string) => invoke<WorkedTask[]>("worked_tasks", { from, to }),
  taskTimeline: (taskId: string) => invoke<HistoryEvent[]>("task_timeline", { taskId }),

  dbInfo: () => invoke<DbInfo>("db_info"),
  backupNow: () => invoke<string>("backup_now"),
  backupDb: () => invoke<string | null>("backup_db"),
  restoreDb: () => invoke<string | null>("restore_db"),
  chooseBackupDir: () => invoke<string | null>("choose_backup_dir"),
  resetBackupDir: () => invoke<void>("reset_backup_dir"),
  openDataFolder: () => invoke<void>("open_data_folder"),
  openBackupFolder: () => invoke<void>("open_backup_folder"),
};

export const isOverdue = (t: Task) =>
  t.status !== "completed" && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();

export type AgendaCategory = "meeting" | "appointment" | "personal" | "office" | "reminder" | "other";

export interface Agenda {
  id: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string | null;
  category: AgendaCategory;
  reminderMinutes: number | null;
  syncStatus: "local_only" | "synced" | "pending_push" | "pending_delete" | "conflict" | "error";
  googleEventId: string | null;
  taskIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AgendaInput {
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  location?: string | null;
  category?: AgendaCategory;
  reminderMinutes?: number | null;
  taskIds?: string[];
}

export const AGENDA_CATEGORIES: Record<AgendaCategory, string> = {
  meeting: "Rapat",
  appointment: "Janji temu",
  personal: "Pribadi",
  office: "Kantor",
  reminder: "Pengingat",
  other: "Lainnya",
};

export const SYNC_LABEL: Record<Agenda["syncStatus"], string> = {
  local_only: "Lokal",
  synced: "Tersinkron",
  pending_push: "Menunggu sync",
  pending_delete: "Menunggu hapus",
  conflict: "Konflik",
  error: "Gagal sync",
};

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO UTC -> nilai untuk <input type="datetime-local"> (waktu lokal) */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });

export interface HistoryEvent {
  id: number;
  taskId: string;
  title: string;
  priority: Priority;
  event: "created" | "status_changed" | "completed" | "reopened";
  fromStatus: Status | null;
  toStatus: Status | null;
  changedAt: string;
  wasLate: boolean;
  dueAt: string | null;
}

export interface WorkedTask {
  id: string;
  title: string;
  description: string | null;
  status: Status;
  priority: Priority;
  category: string | null;
  plannedStart: string | null;
  dueAt: string | null;
  actualStart: string | null;
  completedAt: string | null;
  notes: string | null;
  createdAt: string;
  doneAt: string | null;
  startedAt: string | null;
  late: boolean;
}

export interface BackupFile {
  name: string;
  sizeBytes: number;
  modified: string;
}

export interface DbInfo {
  path: string;
  sizeBytes: number;
  backupsDir: string;
  defaultDir: string;
  isDefault: boolean;
  dirOk: boolean;
  backups: BackupFile[];
}