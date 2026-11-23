import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import {
  DndContext, DragOverlay, PointerSensor, pointerWithin, useDraggable, useDroppable, useSensor, useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import {
  ChevronLeft, ChevronRight, FileText, Folder as FolderIcon, FolderPlus, Pencil, Pin, PinOff, Plus, Search, Trash2,
} from "lucide-react";
import { api } from "../lib/api";
import type { FolderList, Note, NoteItem } from "../lib/api";
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

const OVER = " ring-2 ring-brand-light bg-brand/10";
const rowCls = (on: boolean) =>
  `group flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition ${
    on ? "bg-brand/10 font-medium text-brand" : "text-slate-600 hover:bg-black/5"
  }`;

/** Area yang bisa menerima catatan yang diseret. */
function DropZone({ id, className, onClick, children }: {
  id: string; className: (over: boolean) => string; onClick: () => void; children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} onClick={onClick} className={className(isOver)}>{children}</div>;
}

/** Satu catatan di daftar: bisa diseret, dan bisa menerima catatan lain (membuat folder). */
function NoteRow({ n, selected, showFolder, onOpen }: {
  n: NoteItem; selected: boolean; showFolder: boolean; onOpen: () => void;
}) {
  const drag = useDraggable({ id: `note:${n.id}` });
  const drop = useDroppable({ id: `note:${n.id}` });
  const over = drop.isOver && !drag.isDragging;
  return (
    <button
      ref={(el) => { drag.setNodeRef(el); drop.setNodeRef(el); }}
      {...drag.listeners}
      {...drag.attributes}
      onClick={onOpen}
      className={`mb-0.5 block w-full select-none rounded-xl px-3 py-2.5 text-left transition ${
        drag.isDragging ? "opacity-40" : ""
      } ${over ? "ring-2 ring-brand-light bg-brand/10" : selected ? "bg-brand/10" : "hover:bg-black/5"}`}
    >
      <p className="truncate text-sm font-semibold text-ink">{titleOf(n)}</p>
      <p className="mt-0.5 flex gap-2 text-xs text-slate-400">
        <span className="shrink-0">{shortDate(n.updatedAt)}</span>
        <span className="truncate">{previewOf(n)}</span>
      </p>
      {over ? (
        <p className="mt-0.5 text-[11px] font-medium text-brand">
          {n.folderName ? `Lepas untuk masuk ke folder "${n.folderName}"` : "Lepas untuk membuat folder baru"}
        </p>
      ) : (
        showFolder && n.folderName && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
            <FolderIcon size={11} /> <span className="truncate">{n.folderName}</span>
          </p>
        )
      )}
    </button>
  );
}

export default function NotesPage() {
  const [items, setItems] = useState<NoteItem[]>([]);
  const [folderData, setFolderData] = useState<FolderList>({ folders: [], total: 0, unfiled: 0 });
  const [folder, setFolder] = useState("all"); // "all" | "none" | id folder
  const [showFolders, setShowFolders] = useState(() => {
    try { return localStorage.getItem("notes_folders_open") !== "0"; } catch { return true; }
  });
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null); // id "new" = folder baru
  const [active, setActive] = useState<{ note: Note; fresh: boolean } | null>(null);
  const [noteFolder, setNoteFolder] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const idRef = useRef<string | null>(null);
  const textRef = useRef("");
  const savedRef = useRef("");
  const queryRef = useRef("");
  const folderRef = useRef("all");
  const cancelRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const toggleFolders = (v: boolean) => {
    setShowFolders(v);
    try { localStorage.setItem("notes_folders_open", v ? "1" : "0"); } catch { /* abaikan */ }
  };

  const loadList = useCallback(async () => {
    try {
      const [n, f] = await Promise.all([api.listNotes(queryRef.current, folderRef.current), api.listFolders()]);
      setItems(n);
      setFolderData(f);
      const cur = folderRef.current;
      if (cur !== "all" && cur !== "none" && !f.folders.some((x) => x.id === cur)) setFolder("all");
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    queryRef.current = query;
    folderRef.current = folder;
    loadList();
  }, [query, folder, loadList]);

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
      leave();
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
    setNoteFolder(note?.folderId ?? null);
    setActive(note ? { note, fresh } : null);
  };

  const changeFolder = async (f: string) => {
    if (f === folderRef.current) return;
    await leave();
    select(null);
    setQuery("");
    setFolder(f);
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
      const target = folder !== "all" && folder !== "none" ? folder : null;
      select(await api.createNote(target), true);
    } catch (e) {
      setError(String(e));
    }
  };

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

  const moveTo = async (f: string | null) => {
    if (!active) return;
    try {
      await api.moveNote(active.note.id, f);
      setNoteFolder(f);
      setError(null);
      loadList();
    } catch (e) {
      setError(String(e));
    }
  };

  // ----- Drag & drop catatan -----
  const onDragStart = (e: DragStartEvent) => setDragId(String(e.active.id).replace("note:", ""));

  const onDragEnd = async ({ active: a, over }: DragEndEvent) => {
    setDragId(null);
    if (!over) return;
    const noteId = String(a.id).replace("note:", "");
    const target = String(over.id);
    if (target === `note:${noteId}`) return;
    try {
      await flush();
      if (target.startsWith("folder:")) {
        const f = target.slice(7);
        await api.moveNote(noteId, f === "none" ? null : f);
      } else if (target.startsWith("note:")) {
        const targetId = target.slice(5);
        const hadFolder = !!items.find((n) => n.id === targetId)?.folderId;
        const f = await api.groupNotes(noteId, targetId);
        if (!hadFolder) {
          // folder baru: langsung beri kesempatan mengganti namanya
          toggleFolders(true);
          setEditing({ id: f.id, name: f.name });
        }
      }
      // pastikan menu folder di editor ikut mutakhir
      const cur = idRef.current;
      if (cur) {
        const n = await api.getNote(cur).catch(() => null);
        if (n && idRef.current === cur) setNoteFolder(n.folderId);
      }
      setError(null);
      await loadList();
    } catch (e) {
      setError(String(e));
    }
  };

  // ----- Folder -----
  const saveFolder = async () => {
    if (cancelRef.current) {
      cancelRef.current = false;
      setEditing(null);
      return;
    }
    if (!editing) return;
    const name = editing.name.trim();
    const id = editing.id;
    setEditing(null);
    if (!name) return;
    try {
      if (id === "new") {
        const f = await api.createFolder(name);
        await changeFolder(f.id);
      } else {
        await api.renameFolder(id, name);
      }
      setError(null);
      await loadList();
    } catch (e) {
      setError(String(e));
    }
  };

  const removeFolder = async (id: string, name: string) => {
    if (!confirm(`Hapus folder "${name}"?\n\nCatatan di dalamnya tidak dihapus, hanya dipindahkan ke "Tanpa folder".`)) return;
    try {
      await api.deleteFolder(id);
      if (folderRef.current === id) await changeFolder("all");
      if (noteFolder === id) setNoteFolder(null);
      await loadList();
    } catch (e) {
      setError(String(e));
    }
  };

  const nameInput = (
    <input
      autoFocus
      value={editing?.name ?? ""}
      maxLength={50}
      placeholder="Nama folder"
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setEditing(editing && { ...editing, name: e.target.value })}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          cancelRef.current = true;
          e.currentTarget.blur();
        }
      }}
      onBlur={saveFolder}
      onClick={(e) => e.stopPropagation()}
      className="min-w-0 flex-1 rounded-md bg-white px-1.5 py-0.5 text-sm text-ink outline-none ring-1 ring-brand-light"
    />
  );

  const groups = useMemo(() => {
    const m = new Map<string, NoteItem[]>();
    items.forEach((n) => {
      const g = groupOf(n);
      m.set(g, [...(m.get(g) ?? []), n]);
    });
    return [...m.entries()];
  }, [items]);

  const dragItem = dragId ? items.find((n) => n.id === dragId) : undefined;

  const title =
    folder === "all" ? "Semua catatan" : folder === "none" ? "Tanpa folder"
    : folderData.folders.find((f) => f.id === folder)?.name ?? "Catatan";

  const iconBtn = "rounded-lg p-2 text-slate-500 transition hover:bg-black/5 hover:text-brand disabled:opacity-30";

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragId(null)}
    >
      <div className="flex min-h-0 min-w-0 flex-1">
        {/* Tab folder: klik judul untuk membuka / menutup */}
        <aside className={`flex shrink-0 flex-col border-r border-black/5 bg-white/30 ${showFolders ? "w-44" : "w-10"}`}>
          {showFolders ? (
            <>
              <div className="flex items-center justify-between px-3 pb-2 pt-5">
                <button onClick={() => toggleFolders(false)} title="Tutup daftar folder"
                  className="flex items-center gap-1 rounded-lg px-1 py-1 text-sm font-semibold text-ink hover:text-brand">
                  <ChevronLeft size={16} /> Folder
                </button>
                <button onClick={() => setEditing({ id: "new", name: "" })} title="Folder baru"
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-black/5 hover:text-brand">
                  <FolderPlus size={16} />
                </button>
              </div>

              <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-4">
                <button onClick={() => changeFolder("all")} className={rowCls(folder === "all")}>
                  <FileText size={15} className="shrink-0" />
                  <span className="flex-1 truncate">Semua catatan</span>
                  <span className="text-xs text-slate-400">{folderData.total}</span>
                </button>
                <DropZone id="folder:none" onClick={() => changeFolder("none")}
                  className={(o) => rowCls(folder === "none") + (o ? OVER : "")}>
                  <FolderIcon size={15} className="shrink-0 opacity-50" />
                  <span className="flex-1 truncate">Tanpa folder</span>
                  <span className="text-xs text-slate-400">{folderData.unfiled}</span>
                </DropZone>

                {(folderData.folders.length > 0 || editing?.id === "new") && <div className="my-2 border-t border-black/5" />}

                {folderData.folders.map((f) => (
                  <DropZone key={f.id} id={`folder:${f.id}`} onClick={() => changeFolder(f.id)}
                    className={(o) => rowCls(folder === f.id) + (o ? OVER : "")}>
                    <FolderIcon size={15} className="shrink-0" />
                    {editing?.id === f.id ? nameInput : <span className="flex-1 truncate">{f.name}</span>}
                    {editing?.id !== f.id && (
                      <>
                        <span className="text-xs text-slate-400 group-hover:hidden">{f.count}</span>
                        <span className="hidden items-center group-hover:flex">
                          <button title="Ganti nama" onClick={(e) => { e.stopPropagation(); setEditing({ id: f.id, name: f.name }); }}
                            className="rounded p-1 text-slate-400 hover:text-brand"><Pencil size={13} /></button>
                          <button title="Hapus folder" onClick={(e) => { e.stopPropagation(); removeFolder(f.id, f.name); }}
                            className="rounded p-1 text-slate-400 hover:text-red-500"><Trash2 size={13} /></button>
                        </span>
                      </>
                    )}
                  </DropZone>
                ))}

                {editing?.id === "new" && (
                  <div className={rowCls(false)}>
                    <FolderIcon size={15} className="shrink-0" />
                    {nameInput}
                  </div>
                )}

                {folderData.folders.length === 0 && editing?.id !== "new" && (
                  <p className="px-3 pt-3 text-xs text-slate-400">
                    Buat folder dengan ikon di atas, atau seret satu catatan ke catatan lain.
                  </p>
                )}
              </div>
            </>
          ) : (
            <button onClick={() => toggleFolders(true)} title="Buka daftar folder"
              className="flex h-full w-full flex-col items-center gap-3 pt-5 text-slate-500 hover:bg-black/5 hover:text-brand">
              <ChevronRight size={16} />
              <FolderIcon size={16} />
              <span className="text-xs font-medium [writing-mode:vertical-rl]">Folder</span>
            </button>
          )}
        </aside>

        {/* Daftar catatan */}
        <aside className="flex w-64 shrink-0 flex-col border-r border-black/5 bg-white/50">
          <div className="flex items-center gap-1 px-4 pb-2 pt-5">
            <h1 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{title}</h1>
            <button onClick={create} title="Catatan baru" className="rounded-xl bg-brand p-2 text-white shadow-sm hover:bg-brand/90">
              <Plus size={16} />
            </button>
          </div>

          <div className="relative px-3 pb-2">
            <Search size={14} className="absolute left-6 top-1/2 -translate-y-[60%] text-slate-400" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari catatan"
              className="w-full rounded-xl bg-sand/70 py-2 pl-8 pr-3 text-sm outline-none focus:bg-white focus:ring-2 focus:ring-brand-light/40" />
          </div>

          {error && <p className="mx-3 mb-2 rounded-xl bg-red-50 p-2 text-xs text-red-700">{error}</p>}

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
                  <NoteRow key={n.id} n={n} selected={active?.note.id === n.id}
                    showFolder={folder === "all"} onOpen={() => open(n)} />
                ))}
              </section>
            ))}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex min-w-0 flex-1 flex-col">
          {active ? (
            <>
              <header className="flex items-center justify-between gap-2 px-5 pb-2 pt-4">
                <div className="w-40">
                  <select value={noteFolder ?? ""} onChange={(e) => moveTo(e.target.value || null)} title="Pindahkan ke folder"
                    className="w-full rounded-lg bg-white/70 px-2 py-1.5 text-xs text-slate-600 outline-none ring-1 ring-black/5 focus:ring-brand-light">
                    <option value="">Tanpa folder</option>
                    {folderData.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <p className="truncate text-xs text-slate-400">{updatedAt ? fullDate(updatedAt) : ""}</p>
                <div className="flex w-40 justify-end">
                  <button onClick={togglePin} disabled={!meta} title={meta?.pinned ? "Lepas sematan" : "Sematkan"} className={iconBtn}>
                    {meta?.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                  </button>
                  <button onClick={remove} title="Hapus catatan" className={`${iconBtn} hover:text-red-500`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </header>
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

      <DragOverlay>
        {dragItem ? (
          <div className="w-56 rotate-2 rounded-xl bg-white px-3 py-2.5 shadow-xl ring-1 ring-brand-light">
            <p className="truncate text-sm font-semibold text-ink">{titleOf(dragItem)}</p>
            <p className="truncate text-xs text-slate-400">{previewOf(dragItem)}</p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}