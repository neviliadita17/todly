import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CalendarClock, ExternalLink, EyeOff, Flag, Inbox, ListChecks, Pin, PinOff, Plus, SlidersHorizontal, Timer } from "lucide-react";
import { useTaskStore } from "../stores/taskStore";
import { useAgendaStore } from "../stores/agendaStore";
import { useSync } from "../lib/useSync";
import { api, dayKey, fmtTime, isArchived, isOverdue, toLocalInput } from "../lib/api";
import { useNow } from "../lib/useNow";
import type { Task } from "../lib/api";

const DOT: Record<string, string> = {
  low: "bg-slate-300", medium: "bg-brand-light", high: "bg-amber-400", urgent: "bg-rose-500",
};

const fmtDue = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const dayLabel = (iso: string) => {
  const k = dayKey(new Date(iso));
  if (k === dayKey(new Date())) return "Hari ini";
  if (k === dayKey(new Date(Date.now() + 864e5))) return "Besok";
  return new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "short" });
};

function Section({ title, icon, children }: { title: string; icon: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon} {title}
      </h3>
      {children}
    </section>
  );
}

const Empty = ({ text }: { text: string }) => <p className="px-1.5 py-1 text-xs text-slate-300">{text}</p>;

function TaskRow({ t, onDone }: { t: Task; onDone: () => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-black/5">
      <input type="checkbox" checked={false} onChange={onDone} className="mt-0.5 h-4 w-4 accent-[#3368a0]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink">{t.title}</span>
        <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[t.priority]}`} />
          {t.dueAt ? fmtDue(t.dueAt) : "Tanpa deadline"}
          {t.status === "in_progress" && <span className="font-medium text-orange-500">Dikerjakan</span>}
          {isOverdue(t) && <span className="font-medium text-red-500">Overdue</span>}
        </span>
      </span>
    </label>
  );
}

export default function WidgetApp() {
  const { tasks: allTasks, load: loadTasks, add, move } = useTaskStore();
  const nowTs = useNow();
  const tasks = useMemo(() => allTasks.filter((t) => !isArchived(t, nowTs)), [allTasks, nowTs]);
  const { agendas, load: loadAgendas, save: saveAgenda } = useAgendaStore();
  const [now, setNow] = useState(Date.now());
  const [opacity, setOpacity] = useState(0.92);
  const [pinned, setPinned] = useState(false);
  const [showOpacity, setShowOpacity] = useState(false);
  const [mode, setMode] = useState<null | "task" | "agenda">(null);
  const [text, setText] = useState("");
  const [when, setWhen] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
    api.getSetting("widget_opacity").then((v) => {
      const n = Number(v);
      if (n >= 0.3 && n <= 1) setOpacity(n);
    }).catch(() => {});
    api.getSetting("widget_pinned").then((v) => setPinned(v === "true")).catch(() => {});
    const iv = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(iv);
  }, []);

  // Selalu sinkron dengan database yang sama dengan aplikasi utama
  const reloadAll = useCallback(() => { loadTasks(); loadAgendas(); }, [loadTasks, loadAgendas]);
  useSync(reloadAll);

  const { today, high, upcoming, others, othersTotal, nextAgendas, pct, done } = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "completed");
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    const todayKey = dayKey(new Date(now));
    const byDue = (a: Task, b: Task) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999");
    const done = tasks.length - open.length;

    const today = open
      .filter((t) =>
        t.status === "in_progress" ||
        (t.dueAt && new Date(t.dueAt) <= end) ||
        (t.plannedStart && dayKey(new Date(t.plannedStart)) === todayKey))
      .sort(byDue);
    const high = open.filter((t) => t.priority === "high" || t.priority === "urgent").sort(byDue).slice(0, 3);
    const upcoming = open.filter((t) => t.dueAt && new Date(t.dueAt) > end).sort(byDue).slice(0, 3);

    // Task lain yang belum tampil di bagian mana pun (mis. tanpa deadline, prioritas biasa)
    const shown = new Set([...today, ...high, ...upcoming].map((t) => t.id));
    const rest = open.filter((t) => !shown.has(t.id)).sort(byDue);

    return {
      today, high, upcoming,
      others: rest.slice(0, 6),
      othersTotal: rest.length,
      nextAgendas: agendas.filter((a) => new Date(a.endAt).getTime() >= now).slice(0, 3),
      done,
      pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    };
  }, [tasks, agendas, now]);

  const openMode = (m: "task" | "agenda") => {
    setMode(mode === m ? null : m);
    setText("");
    setErr(null);
    setWhen(toLocalInput(new Date(Math.ceil(Date.now() / 3600000) * 3600000).toISOString()));
  };

  const submit = async () => {
    if (!text.trim() || !mode) return;
    try {
      if (mode === "task") {
        const end = new Date();
        end.setHours(23, 59, 0, 0);
        await add({ title: text, priority: "medium", dueAt: end.toISOString() });
      } else {
        const s = new Date(when);
        await saveAgenda({
          title: text,
          startAt: s.toISOString(),
          endAt: new Date(s.getTime() + 3600000).toISOString(),
          category: "other",
        });
      }
      setText("");
      setMode(null);
      setErr(null);
    } catch (e) {
      setErr(String(e));
    }
  };

  const win = getCurrentWindow();
  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    try {
      await api.setWidgetPinned(next);
    } catch {
      setPinned(!next);
    }
  };
  const d = new Date(now);
  const btn = "rounded-lg p-1.5 text-slate-500 hover:bg-black/5 hover:text-brand";

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-black/10 text-ink"
      style={{ background: `rgba(255,255,255,${opacity})` }}>
            {/* Header: tekan & seret bagian ini untuk memindahkan widget */}
      <header
        onMouseDown={(e) => {
          if (e.button === 0 && !(e.target as HTMLElement).closest("button")) {
            api.widgetDrag().catch(() => {});
          }
        }}
        className="flex cursor-move select-none items-center justify-between px-3.5 pb-2 pt-3"
        >
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-400">
            {d.toLocaleDateString("id-ID", { weekday: "long" })}
          </p>
          <p className="text-base font-semibold leading-tight">
            {d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })}
          </p>
        </div>
        <div className="flex items-center">
          <button
            title={pinned ? "Selalu di atas: AKTIF (klik untuk matikan)" : "Selalu di atas: mati (klik untuk aktifkan)"}
            className={`${btn} ${pinned ? "bg-brand/10 text-brand" : ""}`}
            onClick={togglePin}
          >
            {pinned ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
          <button title="Transparansi" className={btn} onClick={() => setShowOpacity(!showOpacity)}><SlidersHorizontal size={15} /></button>
          <button title="Buka aplikasi utama" className={btn} onClick={() => api.openMain()}><ExternalLink size={15} /></button>
          <button title="Sembunyikan widget" className={btn} onClick={() => api.toggleWidget()}><EyeOff size={15} /></button>
        </div>
      </header>

      {showOpacity && (
        <div className="mx-3.5 mb-2 flex items-center gap-2 rounded-lg bg-black/5 px-2.5 py-1.5 text-[11px] text-slate-500">
          Transparansi
          <input type="range" min={30} max={100} value={Math.round(opacity * 100)} className="flex-1 accent-[#3368a0]"
            onChange={(e) => setOpacity(Number(e.target.value) / 100)}
            onPointerUp={() => api.setSetting("widget_opacity", String(opacity)).catch(() => {})} />
        </div>
      )}

      <div className="mx-3.5 mb-2">
        <div className="mb-1 flex justify-between text-[11px] text-slate-500">
          <span>Progress</span><span>{pct}% · {done}/{tasks.length}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-black/10">
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2.5 pb-2">
        <Section title={`Task hari ini (${today.length})`} icon={<ListChecks size={12} />}>
          {today.length === 0 ? <Empty text="Tidak ada task hari ini 🎉" /> :
            today.map((t) => <TaskRow key={t.id} t={t} onDone={() => move(t.id, "completed")} />)}
        </Section>

        <Section title="Prioritas tinggi" icon={<Flag size={12} />}>
          {high.length === 0 ? <Empty text="Tidak ada" /> :
            high.map((t) => <TaskRow key={t.id} t={t} onDone={() => move(t.id, "completed")} />)}
        </Section>

        <Section title="Agenda terdekat" icon={<CalendarClock size={12} />}>
          {nextAgendas.length === 0 ? <Empty text="Tidak ada agenda" /> :
            nextAgendas.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                <span className="w-14 shrink-0 text-[10px] font-medium text-brand">{dayLabel(a.startAt)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{a.title}</span>
                  <span className="text-[10px] text-slate-400">{fmtTime(a.startAt)} – {fmtTime(a.endAt)}</span>
                </span>
              </div>
            ))}
        </Section>

        <Section title="Deadline mendatang" icon={<Timer size={12} />}>
          {upcoming.length === 0 ? <Empty text="Tidak ada" /> :
            upcoming.map((t) => <TaskRow key={t.id} t={t} onDone={() => move(t.id, "completed")} />)}
        </Section>

        {othersTotal > 0 && (
          <Section title={`Task lainnya (${othersTotal})`} icon={<Inbox size={12} />}>
            {others.map((t) => <TaskRow key={t.id} t={t} onDone={() => move(t.id, "completed")} />)}
            {othersTotal > others.length && (
              <button onClick={() => api.openMain()} className="px-1.5 py-1 text-[11px] text-brand hover:underline">
                +{othersTotal - others.length} lagi — buka aplikasi
              </button>
            )}
          </Section>
        )}
      </div>

      {mode && (
        <div className="space-y-1.5 border-t border-black/5 px-3 py-2">
          {err && <p className="text-[11px] text-red-600">{err}</p>}
          <input autoFocus value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setMode(null); }}
            placeholder={mode === "task" ? "Task hari ini… (Enter)" : "Judul agenda… (Enter)"}
            className="w-full rounded-lg bg-black/5 px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-brand-light/40" />
          {mode === "agenda" && (
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
              className="w-full rounded-lg bg-black/5 px-2.5 py-1.5 text-xs outline-none" />
          )}
        </div>
      )}

      <footer className="flex gap-2 border-t border-black/5 px-3 py-2.5 pr-7">
        <button onClick={() => openMode("task")}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand px-2 py-1.5 text-xs font-medium text-white hover:bg-brand/90">
          <Plus size={13} /> Task
        </button>
        <button onClick={() => openMode("agenda")}
          className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-brand/10 px-2 py-1.5 text-xs font-medium text-brand hover:bg-brand/20">
          <Plus size={13} /> Agenda
        </button>
      </footer>

      <div title="Ubah ukuran" onMouseDown={() => win.startResizeDragging("SouthEast")}
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize">
        <svg viewBox="0 0 20 20" className="h-full w-full text-slate-300">
          <path d="M18 6 6 18M18 11 11 18M18 16 16 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}