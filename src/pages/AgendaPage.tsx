import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Plus, MapPin, Link2 } from "lucide-react";
import { useAgendaStore } from "../stores/agendaStore";
import AgendaForm from "../features/AgendaForm";
import { AGENDA_CATEGORIES, SYNC_LABEL, dayKey, fmtTime } from "../lib/api";
import type { Agenda } from "../lib/api";

type Tab = "today" | "upcoming" | "all";
const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "Hari ini" },
  { id: "upcoming", label: "Mendatang" },
  { id: "all", label: "Semua" },
];

export default function AgendaPage() {
  const { agendas, load } = useAgendaStore();
  const [tab, setTab] = useState<Tab>("today");
  const [form, setForm] = useState<{ agenda?: Agenda } | null>(null);

  useEffect(() => {
    load();
    const un = listen("data-changed", () => load());
    return () => { un.then((f) => f()); };
  }, [load]);

  const today = dayKey(new Date());
  const list = agendas.filter((a) => {
    const k = dayKey(new Date(a.startAt));
    return tab === "all" ? true : tab === "today" ? k === today : k > today;
  });

  return (
    <main className="flex-1 overflow-y-auto p-6 md:p-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Agenda</h1>
          <p className="text-sm text-slate-500">Rapat, janji temu, dan jadwal Anda</p>
        </div>
        <button onClick={() => setForm({})}
          className="flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-brand/90">
          <Plus size={16} /> Agenda Baru
        </button>
      </header>

      <div className="mb-4 inline-flex rounded-xl bg-mist/50 p-1">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-1.5 text-sm transition ${tab === t.id ? "bg-white font-medium text-brand shadow-sm" : "text-slate-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-brand-light/40 py-12 text-center text-sm text-slate-400">
            Tidak ada agenda.
          </p>
        )}
        {list.map((a) => {
          const d = new Date(a.startAt);
          return (
            <article key={a.id} onClick={() => setForm({ agenda: a })}
              className="flex cursor-pointer items-center gap-4 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 transition hover:shadow-md">
              <div className="w-14 shrink-0 rounded-xl bg-mist/60 py-2 text-center">
                <p className="text-[10px] uppercase text-brand">{d.toLocaleDateString("id-ID", { month: "short" })}</p>
                <p className="text-xl font-semibold leading-none text-brand">{d.getDate()}</p>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-800">{a.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span>{fmtTime(a.startAt)} – {fmtTime(a.endAt)}</span>
                  {a.location && <span className="flex items-center gap-1"><MapPin size={12} />{a.location}</span>}
                  {a.taskIds.length > 0 && <span className="flex items-center gap-1"><Link2 size={12} />{a.taskIds.length} task</span>}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1 text-[11px]">
                <span className="rounded-full bg-brand/10 px-2 py-0.5 text-brand">{AGENDA_CATEGORIES[a.category]}</span>
                <span className={a.syncStatus === "conflict" || a.syncStatus === "error" ? "text-red-600" : "text-slate-400"}>
                  {SYNC_LABEL[a.syncStatus]}
                </span>
              </div>
            </article>
          );
        })}
      </div>

      {form && <AgendaForm agenda={form.agenda} onClose={() => setForm(null)} />}
    </main>
  );
}