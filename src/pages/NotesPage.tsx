import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Pin, PinOff, Plus, Search, Trash2 } from "lucide-react";
import { api } from "../lib/api";
import type { Note, NoteItem } from "../lib/api";
import NoteEditor from "../features/NoteEditor";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (iso: string) => Math.round((startOfDay(new Date()) - startOfDay(new Date(iso))) / 864e5);

const groupOf = (n: NoteItem) => {
  if (n.pinned) return "Disematkan";
  const d = daysAgo(n.updatedAt);
  if (d <= 0) return "Hari ini";
  if (d === 1) return "Kemarin";
  if (d <= 7) return "7 hari terakhir";
  if (d <= 30) return "30 hari terakhir";
  return new Date(n.updatedAt).toLocaleDateString("id-ID", { month: "long", year: "numeric" });
};

const titleOf = (n: NoteItem) => n.preview.split("\n")[0] || "Catatan baru";
const previewOf = (n: NoteItem) => n.preview.split("\n")[1] || "Tidak ada teks tambahan";

const shortDate = (iso: string) => {
  const d = daysAgo(iso);
  if (d <= 0) return new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
  if (d === 1) return "Kemarin";
  if (d <= 7) return new Date(iso).toLocaleDateString("id-ID", { weekday: "long" });
  return new Date(iso).toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const fullDate = (iso: string) =>
  `${new Date(iso).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" })} pukul ${new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`;

export default function NotesPage() {
  const [items, setItems] = useState<NoteItem[]>([]);
  const [active, setActive] = useState<{ note: Note; fresh: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  const idRef = useRef<string | null>(null);
  const textRef = useRef("");
  const savedRef = useRef("");
  const queryRef = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const loadList = useCallback(async () => {
    try {
      setItems(await api.listNotes(queryRef.current));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    queryRef.current = query;
    loadList();
  }, [query, loadList]);

  const flush = useCallback(async () => {
    const id = idRef.current;
    if (!id || textRef.current === savedRef.current) return;
    const value = textRef.current;
    try {
      await api.updateNote(id, value);
      savedRef.current = value;
      setError(null);
      await loadList();
    } catch (e) {
      setError(String(e));
    }
  }, [loadList]);

  // Keluar dari catatan: simpan, lalu buang jika kosong (seperti di iPhone)
  const leave = useCallback(async () => {
    clearTimeout(timer.current);
    await flush();
    const id = idRef.current;
    if (id && textRef.current === "") {
      await api.deleteNote(id).catch(() => {});
      await loadList();
    }
  }, [flush, loadList]);

  useEffect(() => {
    const un = listen("data-changed", loadList);
    return () => {
      un.then((f) => f());
      leave(); // keluar dari halaman Catatan
    };
  }, [loadList, leave]);

  useEffect(() => {
    const h = () => { clearTimeout(timer.current); flush(); };
    window.addEventListener("blur", h);
    return () => window.removeEventListener("blur", h);
  }, [flush]);

  const select = (note: Note | null, fresh = false) => {
    idRef.current = note?.id ?? null;
    textRef.current = note?.content ?? "";
    savedRef.current = note?.content ?? "";
    setActive(note ? { note, fresh } : null);
  };

  const open = async (n: NoteItem) => {
    if (n.id === idRef.current) return;
    await leave();
    try {
      select(await api.getNote(n.id));
    } catch (e) {
      setError(String(e));
    }
  };

  const create = async () => {
    await leave();
    try {
      setQuery("");
      select(await api.createNote(), true);
    } catch (e) {
      setError(String(e));
    }
  };

  // Editor melapor setelah siap: isi dasar = HTML yang sudah dinormalkan editor,
  // sehingga membuka catatan tanpa mengubahnya tidak mengubah tanggalnya.
  const onReady = useCallback((h: string) => { textRef.current = h; savedRef.current = h; }, []);
  const onChange = useCallback((h: string) => {
    textRef.current = h;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush]);
  const onBlur = useCallback(() => { clearTimeout(timer.current); flush(); }, [flush]);

  const meta = items.find((n) => n.id === active?.note.id);
  const updatedAt = meta?.updatedAt ?? active?.note.updatedAt;

  const remove = async () => {
    if (!active) return;
    if (textRef.current !== "" && !confirm("Hapus catatan ini?")) return;
    clearTimeout(timer.current);
    const id = active.note.id;
    select(null);
    await api.deleteNote(id).catch((e) => setError(String(e)));
    loadList();
  };

  const togglePin = async () => {
    if (!meta) return;
    await api.setNotePinned(meta.id, !meta.pinned).catch((e) => setError(String(e)));
    loadList();
  };

  const groups = useMemo(() => {
    const m = new Map<string, NoteItem[]>();
    items.forEach((n) => {
      const g = groupOf(n);
      m.set(g, [...(m.get(g) ?? []), n]);
    });
    return [...m.entries()];
  }, [items]);

  const iconBtn = "rounded-lg p-2 text-slate-500 transition hover:bg-black/5 hover:text-brand disabled:opacity-30";

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <aside className="flex w-72 shrink-0 flex-col border-r border-black/5 bg-white/50">
        <div className="flex items-center justify-between px-4 pb-2 pt-5">
          <h1 className="text-xl font-semibold text-ink">Catatan</h1>
          <button onClick={create} title="Catatan baru" className="rounded-xl bg-brand p-2 text-white shadow-sm hover:bg-brand/90">
            <Plus size={16} />
          </button>
        </div>

        <div className="relative px-3 pb-2">
          <Search size={14} className="absolute left-6 top-1/2 -translate-y-[60%] text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari catatan"
            className="w-full rounded-xl bg-sand/70 py-2 pl-8 pr-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-brand-light/40" />
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-slate-400">
              {query ? "Tidak ada catatan yang cocok." : "Belum ada catatan."}
            </p>
          )}
          {groups.map(([g, list]) => (
            <section key={g} className="mb-2">
              <h2 className="px-2 pb-1 pt-3 text-xs font-semibold text-slate-400">{g}</h2>
              {list.map((n) => (
                <button key={n.id} onClick={() => open(n)}
                  className={`mb-0.5 block w-full rounded-xl px-3 py-2.5 text-left transition ${
                    active?.note.id === n.id ? "bg-brand/10" : "hover:bg-black/5"
                  }`}>
                  <p className="truncate text-sm font-semibold text-ink">{titleOf(n)}</p>
                  <p className="mt-0.5 flex gap-2 text-xs text-slate-400">
                    <span className="shrink-0">{shortDate(n.updatedAt)}</span>
                    <span className="truncate">{previewOf(n)}</span>
                  </p>
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="flex items-center justify-between px-6 pt-4 pb-2">
              <span className="w-20" />
              <p className="text-xs text-slate-400">{updatedAt ? fullDate(updatedAt) : ""}</p>
              <div className="flex w-20 justify-end">
                <button onClick={togglePin} disabled={!meta} title={meta?.pinned ? "Lepas sematan" : "Sematkan"} className={iconBtn}>
                  {meta?.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                </button>
                <button onClick={remove} title="Hapus catatan" className={`${iconBtn} hover:text-red-500`}>
                  <Trash2 size={16} />
                </button>
              </div>
            </header>
            {error && <p className="mx-6 mb-2 rounded-xl bg-red-50 p-2.5 text-sm text-red-700">{error}</p>}
            <NoteEditor key={active.note.id} initial={active.note.content} autoFocus={active.fresh}
              onReady={onReady} onChange={onChange} onBlur={onBlur} />
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-400">
            <p className="text-sm">Pilih catatan atau buat yang baru.</p>
            <button onClick={create} className="rounded-xl bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand/90">
              Catatan baru
            </button>
          </div>
        )}
      </section>
    </div>
  );
}