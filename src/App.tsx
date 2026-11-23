import { useCallback, useMemo, useState } from "react";
import { isArchived, isOverdue } from "./lib/api";
import { useNow } from "./lib/useNow";
import {
  ListTodo, CalendarDays, Calendar, CheckCircle2, BarChart3, Settings,
  Plus, Search, AlertCircle, AlertTriangle, Circle, Timer, Layers, FileText,
} from "lucide-react";
import { useTaskStore } from "./stores/taskStore";
import { useAgendaStore } from "./stores/agendaStore";
import { useSync } from "./lib/useSync";
import type { Priority, Status } from "./lib/api";
import AgendaPage from "./pages/AgendaPage";
import CalendarPage from "./pages/CalendarPage";
import HistoryPage from "./pages/HistoryPage";
import SettingsPage from "./pages/SettingsPage";
import KanbanBoard from "./features/KanbanBoard";
import NotesPage from "./pages/NotesPage";

type Page = "dashboard" | "tasks" | "agenda" | "calendar" | "notes" | "completed" | "history" | "settings";

const NAV: { id: Page; label: string; icon: typeof ListTodo; ready: boolean }[] = [
  // { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, ready: false },
  { id: "tasks", label: "My Tasks", icon: ListTodo, ready: true },
  { id: "notes", label: "Notes", icon: FileText, ready: true },
  { id: "agenda", label: "Agenda", icon: CalendarDays, ready: true },
  { id: "calendar", label: "Calendar", icon: Calendar, ready: true },
  // { id: "completed", label: "Completed", icon: CheckCircle2, ready: false },
  { id: "history", label: "History & Reports", icon: BarChart3, ready: true },
  { id: "settings", label: "Settings", icon: Settings, ready: true },
];

function Ring({ pct }: { pct: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative h-11 w-11">
      <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" className="text-mist" />
        <circle cx="22" cy="22" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"
          className="text-brand transition-all duration-700"
          strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-ink">{pct}%</span>
    </div>
  );
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 11 ? "Selamat pagi" : h < 15 ? "Selamat siang" : h < 18 ? "Selamat sore" : "Selamat malam";
};

export default function App() {
  const { tasks: allTasks, error, load, add } = useTaskStore();
  const nowTs = useNow();
  const tasks = useMemo(() => allTasks.filter((t) => !isArchived(t, nowTs)), [allTasks, nowTs]);
  const [page, setPage] = useState<Page>("tasks");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [due, setDue] = useState("");
  const [q, setQ] = useState("");

  const reloadAll = useCallback(() => {
    load();
    useAgendaStore.getState().load();
  }, [load]);
  useSync(reloadAll);

  const submit = async () => {
    if (!title.trim()) return;
    await add({ title, priority, dueAt: due ? new Date(due).toISOString() : null });
    setTitle(""); setDue("");
  };

  const count = (s: Status) => tasks.filter((t) => t.status === s).length;
  const overdue = tasks.filter(isOverdue).length;
  const pct = tasks.length ? Math.round((count("completed") / tasks.length) * 100) : 0;

  const stats = [
    { label: "Total task", value: tasks.length, Icon: Layers, chip: "bg-brand/10 text-brand" },
    { label: "To Do", value: count("todo"), Icon: Circle, chip: "bg-blue-50 text-blue-600" },
    { label: "In Progress", value: count("in_progress"), Icon: Timer, chip: "bg-orange-50 text-orange-600" },
    { label: "Completed", value: count("completed"), Icon: CheckCircle2, chip: "bg-green-50 text-green-600" },
    { label: "Overdue", value: overdue, Icon: AlertTriangle, chip: "bg-red-50 text-red-600" },
  ];

  const field =
    "rounded-xl bg-sand/70 px-3 py-2.5 text-sm text-ink outline-none transition focus:bg-white focus:ring-2 focus:ring-brand-light/40";

  return (
    <div className="flex h-full">
      {/* Sidebar: ramping, melebar saat di-hover, konten ikut menyesuaikan */}
      <aside className="group hidden w-16 shrink-0 flex-col overflow-hidden border-r border-black/5 bg-white/80 px-3 py-4 backdrop-blur transition-[width] duration-200 ease-out hover:w-56 md:flex">
        <div className="mb-6 flex items-center gap-3 pl-0.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand to-brand-light text-white shadow-md">
            <CheckCircle2 size={18} />
          </div>
          <div className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <p className="text-[15px] font-semibold leading-tight text-ink">Todly</p>
            <p className="text-[11px] text-slate-400">To-Do List & Daily Planner</p>
          </div>
        </div>

        <nav className="space-y-1.5">
          {NAV.map(({ id, label, icon: Icon, ready }) => (
            <button key={id} disabled={!ready} onClick={() => setPage(id)}
              aria-label={label}
              className={`flex h-10 w-full items-center gap-3 rounded-xl px-[11px] text-sm transition ${
                page === id
                  ? "bg-brand font-medium text-white shadow-[0_6px_16px_rgb(51_104_160/0.25)]"
                  : ready
                  ? "text-slate-600 hover:bg-sand hover:text-brand"
                  : "cursor-not-allowed text-slate-300"
              }`}>
              <Icon size={18} className="shrink-0" />
              <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                {label}{ready ? "" : " · segera"}
              </span>
            </button>
          ))}
        </nav>

        <div className="mt-auto flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center">
            <div className="scale-90"><Ring pct={pct} /></div>
          </div>
          <div className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <p className="text-sm font-medium text-ink">Progress</p>
            <p className="text-xs text-slate-400">{count("completed")} dari {tasks.length} task selesai</p>
          </div>
        </div>
      </aside>

      {/* Konten */}
      <div key={page} className="rise flex min-h-0 min-w-0 flex-1">
        {page === "agenda" ? (
          <AgendaPage />
        ) : page === "calendar" ? (
          <CalendarPage />
        ) : page === "notes" ? (
          <NotesPage />
        ) : page === "history" ? (
          <HistoryPage />
        ) : page === "settings" ? (
          <SettingsPage />
        ) : (
          <main className="flex-1 overflow-y-auto p-6 md:p-10">
            <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-sm text-slate-400">
                  {new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                </p>
                <h1 className="mt-1 text-3xl font-semibold tracking-tight text-ink">{greeting()} 👋</h1>
                <p className="mt-1 text-sm text-slate-500">
                  {count("in_progress")} task sedang dikerjakan{overdue > 0 ? `, ${overdue} melewati deadline` : ""}.
                </p>
              </div>
              <div className="relative">
                <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari task…"
                  className="w-60 rounded-full border border-black/5 bg-white py-2.5 pl-10 pr-4 text-sm outline-none transition focus:border-brand-light focus:ring-4 focus:ring-brand-light/15" />
              </div>
            </header>

            {error && (
              <p className="mb-5 flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
                <AlertCircle size={16} /> {error}
              </p>
            )}

            <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-5">
              {stats.map(({ label, value, Icon, chip }) => (
                <div key={label} className="card flex items-center gap-3 p-4">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${chip}`}>
                    <Icon size={18} />
                  </span>
                  <div>
                    <p className="text-2xl font-semibold leading-none text-ink">{value}</p>
                    <p className="mt-1 text-xs text-slate-400">{label}</p>
                  </div>
                </div>
              ))}
            </section>

            <section className="card mb-8 flex flex-wrap items-center gap-2 p-2.5">
              <div className="relative min-w-56 flex-1">
                <Plus size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand" />
                <input value={title} onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submit()}
                  placeholder="Tambah task baru, lalu tekan Enter…"
                  className={`${field} w-full pl-10`} />
              </div>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={field}>
                <option value="low">Low</option><option value="medium">Medium</option>
                <option value="high">High</option><option value="urgent">Urgent</option>
              </select>
              <input type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} className={field} />
              <button onClick={submit}
                className="rounded-xl bg-brand px-5 py-2.5 text-sm font-medium text-white shadow-[0_6px_16px_rgb(51_104_160/0.25)] transition hover:bg-brand/90 active:scale-95">
                Tambah
              </button>
            </section>

            <KanbanBoard query={q} />
          </main>
        )}
      </div>
    </div>
  );
}