import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAgendaStore } from "../stores/agendaStore";
import { useTaskStore } from "../stores/taskStore";
import AgendaForm from "../features/AgendaForm";
import { dayKey, fmtTime, isOverdue } from "../lib/api";
import type { Agenda } from "../lib/api";

type View = "month" | "week" | "day";
const VIEWS: { id: View; label: string }[] = [
  { id: "month", label: "Bulan" },
  { id: "week", label: "Minggu" },
  { id: "day", label: "Hari" },
];
const WEEKDAYS = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const monday = (d: Date) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
};

export default function CalendarPage() {
  const { agendas, load } = useAgendaStore();
  const tasks = useTaskStore((s) => s.tasks);
  const [view, setView] = useState<View>("month");
  const [cursor, setCursor] = useState(new Date());
  const [form, setForm] = useState<{ agenda?: Agenda; date?: Date } | null>(null);

  useEffect(() => {
    load();
    const un = listen("data-changed", () => load());
    return () => { un.then((f) => f()); };
  }, [load]);

  const days = useMemo(() => {
    if (view === "day") return [new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate())];
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(monday(cursor), i));
    const start = monday(new Date(cursor.getFullYear(), cursor.getMonth(), 1));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
  }, [view, cursor]);

  const shift = (n: number) => {
    const c = new Date(cursor);
    if (view === "month") { c.setDate(1); c.setMonth(c.getMonth() + n); }
    else c.setDate(c.getDate() + (view === "week" ? 7 * n : n));
    setCursor(c);
  };

  const title =
    view === "day"
      ? cursor.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
      : cursor.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const todayKey = dayKey(new Date());
  const max = view === "month" ? 3 : 99;

  return (
    <main className="flex-1 overflow-y-auto p-6 md:p-8">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold capitalize text-slate-800">{title}</h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl bg-mist/50 p-1">
            {VIEWS.map((v) => (
              <button key={v.id} onClick={() => setView(v.id)}
                className={`rounded-lg px-3 py-1.5 text-sm ${view === v.id ? "bg-white font-medium text-brand shadow-sm" : "text-slate-600"}`}>
                {v.label}
              </button>
            ))}
          </div>
          <button onClick={() => shift(-1)} className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-black/5"><ChevronLeft size={16} /></button>
          <button onClick={() => setCursor(new Date())} className="rounded-lg bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-black/5">Hari ini</button>
          <button onClick={() => shift(1)} className="rounded-lg bg-white p-2 shadow-sm ring-1 ring-black/5"><ChevronRight size={16} /></button>
        </div>
      </header>

      {view !== "day" && (
        <div className="mb-1 grid grid-cols-7 text-center text-xs text-slate-500">
          {WEEKDAYS.map((d) => <div key={d}>{d}</div>)}
        </div>
      )}

      <div className={`grid gap-1.5 ${view === "day" ? "grid-cols-1" : "grid-cols-7"}`}>
        {days.map((d) => {
          const k = dayKey(d);
          const dayAgendas = agendas.filter((a) => dayKey(new Date(a.startAt)) === k);
          const dayTasks = tasks.filter((t) => t.status !== "completed" && t.dueAt && dayKey(new Date(t.dueAt)) === k);
          const items = [
            ...dayAgendas.map((a) => ({ type: "a" as const, a })),
            ...dayTasks.map((t) => ({ type: "t" as const, t })),
          ];
          const outside = view === "month" && d.getMonth() !== cursor.getMonth();
          return (
            <div key={k} onClick={() => setForm({ date: d })}
              className={`cursor-pointer rounded-xl p-1.5 ring-1 ring-black/5 transition hover:ring-brand-light ${
                view === "month" ? "min-h-24" : "min-h-56"
              } ${outside ? "bg-white/40" : "bg-white"}`}>
              <p className={`mb-1 text-xs ${k === todayKey ? "inline-block rounded-full bg-brand px-1.5 font-semibold text-white" : "text-slate-500"}`}>
                {d.getDate()}
              </p>
              <div className="space-y-1">
                {items.slice(0, max).map((it) =>
                  it.type === "a" ? (
                    <button key={it.a.id} onClick={(e) => { e.stopPropagation(); setForm({ agenda: it.a }); }}
                      className="block w-full truncate rounded-md bg-brand/10 px-1.5 py-0.5 text-left text-[11px] text-brand hover:bg-brand/20">
                      {fmtTime(it.a.startAt)} {it.a.title}
                    </button>
                  ) : (
                    <p key={it.t.id} title="Deadline task"
                      className={`truncate rounded-md px-1.5 py-0.5 text-[11px] ${isOverdue(it.t) ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                      ⚑ {it.t.title}
                    </p>
                  ),
                )}
                {items.length > max && <p className="px-1 text-[10px] text-slate-400">+{items.length - max} lagi</p>}
              </div>
            </div>
          );
        })}
      </div>

      {form && <AgendaForm agenda={form.agenda} date={form.date} onClose={() => setForm(null)} />}
    </main>
  );
}