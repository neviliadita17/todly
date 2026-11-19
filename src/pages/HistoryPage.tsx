import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, ChevronLeft, ChevronRight, Circle, PlayCircle, RotateCcw, X } from "lucide-react";
import { useEffect } from "react";
import { api, dayKey, fmtTime } from "../lib/api";
import type { HistoryEvent, WorkedTask } from "../lib/api";
import { useSync } from "../lib/useSync";

type Period = "week" | "month";
type Filter = "all" | "completed" | "open";

const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];

const STATUS = {
  todo: { label: "To Do", cls: "bg-blue-50 text-blue-600" },
  in_progress: { label: "In Progress", cls: "bg-orange-50 text-orange-600" },
  completed: { label: "Completed", cls: "bg-green-50 text-green-600" },
};

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const monday = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
};
function rangeOf(p: Period, cursor: Date): [Date, Date] {
  if (p === "week") {
    const s = monday(cursor);
    return [s, addDays(s, 7)];
  }
  return [new Date(cursor.getFullYear(), cursor.getMonth(), 1), new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)];
}

const fmtDT = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const duration = (a: string | null, b: string | null) => {
  if (!a || !b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (ms < 0) return "—";
  const m = Math.round(ms / 60000);
  if (m < 1) return "kurang dari 1 menit";
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  return [d ? `${d} hari` : "", h ? `${h} jam` : "", !d && mm ? `${mm} menit` : ""].filter(Boolean).join(" ");
};

const eventMeta = (e: HistoryEvent) => {
  if (e.event === "completed") return { label: "Diselesaikan", Icon: CheckCircle2, cls: "text-green-600" };
  if (e.event === "reopened") return { label: "Dibuka kembali", Icon: RotateCcw, cls: "text-amber-600" };
  if (e.event === "created") return { label: "Dibuat", Icon: Circle, cls: "text-slate-400" };
  if (e.toStatus === "in_progress") return { label: "Mulai dikerjakan", Icon: PlayCircle, cls: "text-orange-600" };
  return { label: "Kembali ke To Do", Icon: Circle, cls: "text-blue-600" };
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-0.5 text-sm text-ink">{children}</div>
    </div>
  );
}

function Detail({ task, onClose }: { task: WorkedTask; onClose: () => void }) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);

  useEffect(() => {
    api.taskTimeline(task.id).then(setEvents).catch(() => setEvents([]));
  }, [task.id, task.status, task.completedAt]);

  const st = STATUS[task.status];
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/25" onClick={onClose}>
      <aside onClick={(e) => e.stopPropagation()} className="rise h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold leading-snug text-ink">{task.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 font-medium ${st.cls}`}>{st.label}</span>
              <span className="rounded-full bg-sand px-2 py-0.5 capitalize text-slate-600">{task.priority}</span>
              {task.category && <span className="rounded-full bg-sand px-2 py-0.5 text-slate-600">{task.category}</span>}
              {task.late && <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600">Terlambat</span>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="space-y-4">
          <Field label="Deskripsi"><p className="whitespace-pre-wrap">{task.description || "—"}</p></Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Dibuat">{fmtDT(task.createdAt)}</Field>
            <Field label="Rencana mulai">{fmtDT(task.plannedStart)}</Field>
            <Field label="Deadline">{fmtDT(task.dueAt)}</Field>
            <Field label="Mulai aktual">{fmtDT(task.actualStart)}</Field>
            <Field label="Selesai">{fmtDT(task.completedAt)}</Field>
            <Field label="Lama pengerjaan">{duration(task.actualStart, task.completedAt)}</Field>
          </div>

          <Field label="Catatan"><p className="whitespace-pre-wrap">{task.notes || "—"}</p></Field>

          <div>
            <p className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Riwayat perubahan status</p>
            <ol className="space-y-2 border-l border-mist pl-4">
              {events.length === 0 && <li className="text-xs text-slate-400">Belum ada riwayat.</li>}
              {events.map((ev) => {
                const { label, Icon, cls } = eventMeta(ev);
                return (
                  <li key={ev.id} className="relative">
                    <span className={`absolute -left-[25px] top-0.5 rounded-full bg-white ${cls}`}><Icon size={14} /></span>
                    <p className="text-sm text-ink">
                      {label}
                      {ev.event === "completed" && ev.wasLate && <span className="ml-2 text-xs text-red-500">terlambat</span>}
                    </p>
                    <p className="text-xs text-slate-400">{fmtDT(ev.changedAt)}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </aside>
    </div>
  );
}

export default function HistoryPage() {
  const [period, setPeriod] = useState<Period>("month");
  const [cursor, setCursor] = useState(new Date());
  const [filter, setFilter] = useState<Filter>("all");
  const [tasks, setTasks] = useState<WorkedTask[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [start, end] = useMemo(() => rangeOf(period, cursor), [period, cursor]);

  const load = useCallback(async () => {
    try {
      setTasks(await api.workedTasks(start.toISOString(), end.toISOString()));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [start, end]);
  useSync(load);

  const shift = (n: number) =>
    setCursor(period === "week" ? addDays(cursor, 7 * n) : new Date(cursor.getFullYear(), cursor.getMonth() + n, 1));

  const label =
    period === "month"
      ? `${MONTHS[start.getMonth()]} ${start.getFullYear()}`
      : `${start.toLocaleDateString("id-ID", { day: "numeric", month: "short" })} – ${addDays(end, -1).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}`;

  const thisYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => thisYear - 3 + i);
  if (!years.includes(cursor.getFullYear())) years.push(cursor.getFullYear());
  years.sort();

  const completed = tasks.filter((t) => t.doneAt);
  const late = completed.filter((t) => t.late).length;
  const onTime = completed.length ? Math.round(((completed.length - late) / completed.length) * 100) : 0;

  const bars = useMemo(() => {
    const counts = new Map<string, number>();
    tasks.filter((t) => t.doneAt).forEach((t) => {
      const k = dayKey(new Date(t.doneAt as string));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const out: { key: string; date: Date; n: number }[] = [];
    for (let d = new Date(start); d < end; d = addDays(d, 1)) out.push({ key: dayKey(d), date: d, n: counts.get(dayKey(d)) ?? 0 });
    return out;
  }, [tasks, start, end]);
  const max = Math.max(1, ...bars.map((b) => b.n));

  const shown = tasks.filter((t) => (filter === "all" ? true : filter === "completed" ? !!t.doneAt : t.status !== "completed"));
  const when = (t: WorkedTask) => (t.doneAt ?? t.startedAt) as string;
  const groups = new Map<string, WorkedTask[]>();
  shown.forEach((t) => {
    const k = dayKey(new Date(when(t)));
    groups.set(k, [...(groups.get(k) ?? []), t]);
  });

  const selected = tasks.find((t) => t.id === selectedId) ?? null;

  const stats = [
    { label: "Task dikerjakan", value: tasks.length, cls: "text-brand" },
    { label: "Selesai", value: completed.length, cls: "text-green-600" },
    { label: "Tepat waktu", value: `${onTime}%`, cls: "text-brand" },
    { label: "Terlambat", value: late, cls: "text-red-600" },
  ];

  const sel = "rounded-xl border border-black/5 bg-white px-3 py-2 text-sm text-ink shadow-sm outline-none focus:ring-2 focus:ring-brand-light/40";

  return (
    <main className="flex-1 overflow-y-auto p-6 md:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">History & Reports</h1>
          <p className="text-sm text-slate-500">Task yang Anda kerjakan pada {label}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-mist/50 p-1">
            {(["month", "week"] as Period[]).map((p) => (
              <button key={p} onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-sm ${period === p ? "bg-white font-medium text-brand shadow-sm" : "text-slate-600"}`}>
                {p === "month" ? "Bulan" : "Minggu"}
              </button>
            ))}
          </div>
          <button onClick={() => shift(-1)} className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-black/5"><ChevronLeft size={16} /></button>
          {period === "month" && (
            <>
              <select className={sel} value={cursor.getMonth()}
                onChange={(e) => setCursor(new Date(cursor.getFullYear(), Number(e.target.value), 1))}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <select className={sel} value={cursor.getFullYear()}
                onChange={(e) => setCursor(new Date(Number(e.target.value), cursor.getMonth(), 1))}>
                {years.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </>
          )}
          <button onClick={() => shift(1)} className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-black/5"><ChevronRight size={16} /></button>
          <button onClick={() => setCursor(new Date())} className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-black/5">
            {period === "week" ? "Minggu ini" : "Bulan ini"}
          </button>
        </div>
      </header>

      {error && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-slate-500">{s.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </section>

      <section className="card mb-5 p-4">
        <p className="mb-3 text-sm font-medium text-slate-700">Task selesai per hari</p>
        <div className="flex h-32 items-end gap-1">
          {bars.map((b) => (
            <div key={b.key} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              title={`${b.date.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}: ${b.n} selesai`}>
              {b.n > 0 && <span className="text-[10px] font-medium text-brand">{b.n}</span>}
              <div className={`w-full rounded-t ${b.n ? "bg-brand-light" : "bg-mist/60"}`} style={{ height: b.n ? `${(b.n / max) * 75}%` : "4px" }} />
              <span className="text-[10px] text-slate-400">
                {period === "week" ? b.date.toLocaleDateString("id-ID", { weekday: "short" }) : b.date.getDate()}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="mb-3 inline-flex rounded-xl bg-mist/50 p-1">
        {([["all", "Semua"], ["completed", "Selesai"], ["open", "Belum selesai"]] as [Filter, string][]).map(([f, l]) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-lg px-3 py-1.5 text-sm ${filter === f ? "bg-white font-medium text-brand shadow-sm" : "text-slate-600"}`}>
            {l}
          </button>
        ))}
      </div>

      {groups.size === 0 && (
        <p className="rounded-2xl border border-dashed border-brand-light/40 py-12 text-center text-sm text-slate-400">
          Tidak ada task yang dikerjakan pada {label}.
        </p>
      )}

      <div className="space-y-4">
        {[...groups.entries()].map(([k, list]) => (
          <section key={k}>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {new Date(when(list[0])).toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long" })}
            </h2>
            <div className="space-y-1.5">
              {list.map((t) => (
                <article key={t.id} onClick={() => setSelectedId(t.id)}
                  className="card flex cursor-pointer items-center gap-3 px-4 py-3 transition hover:-translate-y-0.5 hover:shadow-md">
                  {t.doneAt ? <CheckCircle2 size={18} className="shrink-0 text-green-600" /> : <PlayCircle size={18} className="shrink-0 text-orange-600" />}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{t.title}</p>
                    <p className="text-xs text-slate-500">
                      {t.doneAt ? `Selesai ${fmtTime(t.doneAt)}` : `Mulai dikerjakan ${fmtTime(t.startedAt as string)}`}
                      {t.doneAt && t.actualStart ? ` · ${duration(t.actualStart, t.doneAt)}` : ""}
                    </p>
                  </div>
                  {t.late && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600">Terlambat</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS[t.status].cls}`}>{STATUS[t.status].label}</span>
                  <span className="rounded-full bg-sand px-2 py-0.5 text-[11px] capitalize text-slate-600">{t.priority}</span>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>

      {selected && <Detail task={selected} onClose={() => setSelectedId(null)} />}
    </main>
  );
}