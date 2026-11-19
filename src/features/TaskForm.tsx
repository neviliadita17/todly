import { useEffect, useState } from "react";
import { X, Trash2 } from "lucide-react";
import { api, toLocalInput } from "../lib/api";
import type { Priority, Task } from "../lib/api";
import { useTaskStore } from "../stores/taskStore";
import { useUiStore } from "../stores/uiStore";

const field =
  "w-full rounded-xl bg-sand px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-light/40";

const REMINDERS = [
  { v: "", l: "Tanpa pengingat" },
  { v: "30", l: "30 menit sebelum deadline" },
  { v: "60", l: "1 jam sebelum deadline" },
  { v: "1440", l: "1 hari sebelum deadline" },
];

function Editor({ task }: { task: Task }) {
  const close = useUiStore((s) => s.close);
  const remove = useTaskStore((s) => s.remove);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [planned, setPlanned] = useState(task.plannedStart ? toLocalInput(task.plannedStart) : "");
  const [due, setDue] = useState(task.dueAt ? toLocalInput(task.dueAt) : "");
  const [notes, setNotes] = useState(task.notes ?? "");
  const [reminder, setReminder] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getTaskReminder(task.id).then((m) => setReminder(m == null ? "" : String(m))).catch(() => {});
  }, [task.id]);

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("id-ID") : "—");

  const submit = async () => {
    setError(null);
    try {
      await api.updateTask(task.id, {
        title,
        description: description || null,
        priority,
        categoryId: task.categoryId,
        plannedStart: planned ? new Date(planned).toISOString() : null,
        dueAt: due ? new Date(due).toISOString() : null,
        notes: notes || null,
      });
      await api.setTaskReminder(task.id, due && reminder !== "" ? Number(reminder) : null);
      await useTaskStore.getState().load();
      close();
    } catch (e) {
      setError(String(e));
    }
  };

  const del = async () => {
    if (!confirm("Hapus task ini?")) return;
    await remove(task.id);
    close();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={close}>
      <div className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Edit Task</h2>
          <button onClick={close} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        {error && <p className="rounded-xl bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}

        <input className={field} placeholder="Judul task" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className={field} rows={2} placeholder="Deskripsi" value={description}
          onChange={(e) => setDescription(e.target.value)} />

        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">Prioritas
            <select className={field} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              <option value="low">Low</option><option value="medium">Medium</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="text-xs text-slate-500">Pengingat
            <select className={field} value={reminder} onChange={(e) => setReminder(e.target.value)}>
              {REMINDERS.map((r) => <option key={r.v} value={r.v}>{r.l}</option>)}
            </select>
          </label>
          <label className="text-xs text-slate-500">Mulai (rencana)
            <input type="datetime-local" className={field} value={planned} onChange={(e) => setPlanned(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">Deadline
            <input type="datetime-local" className={field} value={due} onChange={(e) => setDue(e.target.value)} />
          </label>
        </div>
        {!due && reminder !== "" && (
          <p className="text-xs text-amber-600">Pengingat butuh deadline; tanpa deadline pengingat tidak disimpan.</p>
        )}

        <textarea className={field} rows={3} placeholder="Catatan tambahan" value={notes}
          onChange={(e) => setNotes(e.target.value)} />

        <p className="text-xs text-slate-400">
          Mulai aktual: {fmt(task.actualStart)} · Selesai: {fmt(task.completedAt)}
        </p>

        <div className="flex items-center justify-between pt-1">
          <button onClick={del} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50">
            <Trash2 size={15} /> Hapus
          </button>
          <div className="flex gap-2">
            <button onClick={close} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Batal</button>
            <button onClick={submit} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">Simpan</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaskForm() {
  const id = useUiStore((s) => s.editingId);
  const task = useTaskStore((s) => s.tasks.find((t) => t.id === id));
  return task ? <Editor key={task.id} task={task} /> : null;
}