import { useState } from "react";
import { X, Trash2 } from "lucide-react";
import { useAgendaStore } from "../stores/agendaStore";
import { useTaskStore } from "../stores/taskStore";
import { AGENDA_CATEGORIES, toLocalInput } from "../lib/api";
import type { Agenda, AgendaCategory } from "../lib/api";

interface Props {
  agenda?: Agenda;
  date?: Date;
  onClose: () => void;
}

const REMINDERS = [
  { v: "", l: "Tanpa pengingat" },
  { v: "10", l: "10 menit sebelum" },
  { v: "30", l: "30 menit sebelum" },
  { v: "60", l: "1 jam sebelum" },
  { v: "1440", l: "1 hari sebelum" },
];

const field =
  "w-full rounded-xl bg-sand px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-brand-light/40";

export default function AgendaForm({ agenda, date, onClose }: Props) {
  const { save, remove } = useAgendaStore();
  const tasks = useTaskStore((s) => s.tasks);
  const base = date
    ? new Date(date.getFullYear(), date.getMonth(), date.getDate(), 9, 0)
    : new Date();

  const [title, setTitle] = useState(agenda?.title ?? "");
  const [description, setDescription] = useState(agenda?.description ?? "");
  const [start, setStart] = useState(toLocalInput(agenda?.startAt ?? base.toISOString()));
  const [end, setEnd] = useState(
    toLocalInput(agenda?.endAt ?? new Date(base.getTime() + 3600000).toISOString()),
  );
  const [location, setLocation] = useState(agenda?.location ?? "");
  const [category, setCategory] = useState<AgendaCategory>(agenda?.category ?? "meeting");
  const [reminder, setReminder] = useState(agenda?.reminderMinutes != null ? String(agenda.reminderMinutes) : "");
  const [taskIds, setTaskIds] = useState<string[]>(agenda?.taskIds ?? []);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setTaskIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    setError(null);
    try {
      await save(
        {
          title,
          description: description || null,
          startAt: new Date(start).toISOString(),
          endAt: new Date(end).toISOString(),
          location: location || null,
          category,
          reminderMinutes: reminder === "" ? null : Number(reminder),
          taskIds,
        },
        agenda?.id,
      );
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  const del = async () => {
    if (!agenda || !confirm("Hapus agenda ini?")) return;
    try {
      await remove(agenda.id);
      onClose();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg space-y-3 overflow-y-auto rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-800">{agenda ? "Edit Agenda" : "Agenda Baru"}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {error && <p className="rounded-xl bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}

        <input className={field} placeholder="Judul agenda" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-slate-500">
            Mulai
            <input type="datetime-local" className={field} value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">
            Selesai
            <input type="datetime-local" className={field} value={end} onChange={(e) => setEnd(e.target.value)} />
          </label>
        </div>
        <input className={field} placeholder="Lokasi (opsional)" value={location} onChange={(e) => setLocation(e.target.value)} />
        <div className="grid grid-cols-2 gap-2">
          <select className={field} value={category} onChange={(e) => setCategory(e.target.value as AgendaCategory)}>
            {Object.entries(AGENDA_CATEGORIES).map(([k, l]) => (
              <option key={k} value={k}>{l}</option>
            ))}
          </select>
          <select className={field} value={reminder} onChange={(e) => setReminder(e.target.value)}>
            {REMINDERS.map((r) => (
              <option key={r.v} value={r.v}>{r.l}</option>
            ))}
          </select>
        </div>
        <textarea className={field} rows={2} placeholder="Deskripsi (opsional)" value={description} onChange={(e) => setDescription(e.target.value)} />

        <div>
          <p className="mb-1 text-xs text-slate-500">Hubungkan dengan task</p>
          <div className="max-h-32 space-y-1 overflow-y-auto rounded-xl bg-sand p-2">
            {tasks.length === 0 && <p className="text-xs text-slate-400">Belum ada task.</p>}
            {tasks.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={taskIds.includes(t.id)} onChange={() => toggle(t.id)} />
                {t.title}
              </label>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          {agenda ? (
            <button onClick={del} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm text-red-600 hover:bg-red-50">
              <Trash2 size={15} /> Hapus
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Batal</button>
            <button onClick={submit} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">Simpan</button>
          </div>
        </div>
      </div>
    </div>
  );
}