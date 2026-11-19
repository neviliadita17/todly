import { useEffect, useMemo, useState } from "react";
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  closestCorners, useSensor, useSensors, useDroppable,
} from "@dnd-kit/core";
import type { DragEndEvent, DragOverEvent, DragStartEvent } from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Clock, X } from "lucide-react";
import { useTaskStore } from "../stores/taskStore";
import { isOverdue } from "../lib/api";
import { useUiStore } from "../stores/uiStore";
import TaskForm from "./TaskForm";
import type { Priority, Status, Task } from "../lib/api";

const COLS: { key: Status; label: string; dot: string }[] = [
  { key: "todo", label: "To Do", dot: "bg-blue-500" },
  { key: "in_progress", label: "In Progress", dot: "bg-orange-500" },
  { key: "completed", label: "Completed", dot: "bg-green-500" },
];

const ACCENT: Record<Priority, string> = {
  low: "border-l-slate-300",
  medium: "border-l-brand-light",
  high: "border-l-amber-400",
  urgent: "border-l-rose-500",
};

const PRIORITY_TEXT: Record<Priority, string> = {
  low: "text-slate-500",
  medium: "text-brand",
  high: "text-amber-600",
  urgent: "text-rose-600",
};

type Cols = Record<Status, string[]>;

const build = (tasks: Task[]): Cols => {
  const out: Cols = { todo: [], in_progress: [], completed: [] };
  [...tasks]
    .sort((a, b) => a.sortOrder - b.sortOrder || b.createdAt.localeCompare(a.createdAt))
    .forEach((t) => out[t.status].push(t.id));
  return out;
};

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

function TaskCard({ task, overlay, onDelete }: { task: Task; overlay?: boolean; onDelete?: () => void }) {
  const late = isOverdue(task);
  return (
    <article
      className={`group rounded-xl border border-black/5 border-l-[3px] bg-white p-3.5 ${ACCENT[task.priority]} ${
        overlay
          ? "rotate-2 scale-[1.03] cursor-grabbing shadow-[0_16px_40px_rgb(51_104_160/0.25)]"
          : "cursor-grab shadow-[0_1px_2px_rgb(16_24_40/0.05)] transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgb(51_104_160/0.12)]"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className={`text-sm font-medium leading-snug ${
          task.status === "completed" ? "text-slate-400 line-through" : "text-ink"
        }`}>
          {task.title}
        </p>
        {onDelete && (
          <button
            title="Hapus"
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            className="-mr-1 -mt-1 rounded-lg p-1 text-slate-300 opacity-0 transition hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
          >
            <X size={14} />
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
        <span className={`font-semibold uppercase tracking-wide ${PRIORITY_TEXT[task.priority]}`}>
          {task.priority}
        </span>
        {task.dueAt && (
          <span className={`flex items-center gap-1 ${late ? "text-red-500" : "text-slate-400"}`}>
            <Clock size={12} />
            {new Date(task.dueAt).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </span>
        )}
        {late && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-600">Overdue</span>
        )}
      </div>
    </article>
  );
}

function SortableCard({ task, disabled, onDelete }: { task: Task; disabled: boolean; onDelete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled,
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.25 : 1 }}
      {...attributes}
      {...listeners}
      onClick={() => useUiStore.getState().edit(task.id)}
    >
      <TaskCard task={task} onDelete={onDelete} />
    </div>
  );
}

function Column({
  col, ids, byId, disabled, highlight, onDelete,
}: {
  col: (typeof COLS)[number];
  ids: string[];
  byId: Map<string, Task>;
  disabled: boolean;
  highlight: boolean;
  onDelete: (id: string) => void;
}) {
  const { setNodeRef } = useDroppable({ id: col.key });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-80 rounded-2xl border p-3 transition ${
        highlight
          ? "border-brand-light/60 bg-white shadow-[0_8px_30px_rgb(51_104_160/0.12)]"
          : "border-black/5 bg-white/50"
      }`}
    >
      <div className="mb-3 flex items-center justify-between px-1.5 pt-1">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${col.dot}`} />
          <h2 className="text-sm font-semibold text-ink">{col.label}</h2>
        </div>
        <span className="rounded-full bg-sand px-2.5 py-0.5 text-xs font-medium text-slate-500">{ids.length}</span>
      </div>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="min-h-48 space-y-2.5">
          {ids.length === 0 && (
            <p className="rounded-xl border border-dashed border-brand-light/40 py-10 text-center text-xs text-slate-400">
              Seret task ke sini
            </p>
          )}
          {ids.map((id) => {
            const t = byId.get(id);
            return t ? <SortableCard key={id} task={t} disabled={disabled} onDelete={() => onDelete(id)} /> : null;
          })}
        </div>
      </SortableContext>
    </div>
  );
}

export default function KanbanBoard({ query }: { query: string }) {
  const { tasks, reorder, remove } = useTaskStore();
  const [cols, setCols] = useState<Cols>(() => build(tasks));
  const [activeId, setActiveId] = useState<string | null>(null);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const filtering = query.trim() !== "";

  useEffect(() => {
    if (!activeId) setCols(build(tasks));
  }, [tasks, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findCol = (id: string): Status | null => {
    if (id in cols) return id as Status;
    return (Object.keys(cols) as Status[]).find((k) => cols[k].includes(id)) ?? null;
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const id = String(active.id);
    const from = findCol(id);
    const to = findCol(String(over.id));
    if (!from || !to || from === to) return;
    setCols((prev) => {
      const target = [...prev[to]];
      const overIdx = target.indexOf(String(over.id));
      let idx = target.length;
      if (overIdx >= 0) {
        const moved = active.rect.current.translated;
        const below = !!moved && moved.top > over.rect.top + over.rect.height / 2;
        idx = overIdx + (below ? 1 : 0);
      }
      target.splice(idx, 0, id);
      return { ...prev, [from]: prev[from].filter((x) => x !== id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    setActiveId(null);
    const col = findCol(id);
    if (!col) return;

    let next = cols;
    if (over) {
      const overId = String(over.id);
      if (overId !== id && findCol(overId) === col && cols[col].includes(overId)) {
        next = { ...cols, [col]: arrayMove(cols[col], cols[col].indexOf(id), cols[col].indexOf(overId)) };
        setCols(next);
      }
    }

    const original = byId.get(id)?.status;
    const baseline = build(tasks)[col];
    if (original === col && same(next[col], baseline)) return;
    reorder(id, col, next[col]);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setCols(build(tasks));
  };

  const matches = (id: string) => byId.get(id)?.title.toLowerCase().includes(query.toLowerCase());
  const activeTask = activeId ? byId.get(activeId) : undefined;

  return (
    <>
      {filtering && (
        <p className="mb-3 text-xs text-slate-400">Hapus kata pencarian untuk mengatur urutan dengan drag &amp; drop.</p>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <section className="grid gap-4 lg:grid-cols-3">
          {COLS.map((col) => (
            <Column
              key={col.key}
              col={col}
              ids={filtering ? cols[col.key].filter(matches) : cols[col.key]}
              byId={byId}
              disabled={filtering}
              highlight={!!activeId && cols[col.key].includes(activeId)}
              onDelete={(id) => confirm("Hapus task ini?") && remove(id)}
            />
          ))}
        </section>
        <DragOverlay>{activeTask ? <TaskCard task={activeTask} overlay /> : null}</DragOverlay>
      </DndContext>
      <TaskForm />
    </>
  );
}