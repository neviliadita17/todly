import { create } from "zustand";
import { api } from "../lib/api";
import type { Status, Task, TaskInput } from "../lib/api";

interface TaskState {
  tasks: Task[];
  error: string | null;
  load: () => Promise<void>;
  add: (input: TaskInput) => Promise<void>;
  move: (id: string, status: Status) => Promise<void>;
  reorder: (id: string, status: Status, ordered: string[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export const useTaskStore = create<TaskState>((set, get) => {
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      set({ error: null });
    } catch (e) {
      set({ error: String(e) });
    }
    // Backend adalah sumber kebenaran: selalu muat ulang (ini juga mengembalikan tampilan jika gagal)
    await get().load();
  };
  return {
    tasks: [],
    error: null,
    load: async () => {
      try {
        set({ tasks: await api.listTasks() });
      } catch (e) {
        set({ error: String(e) });
      }
    },
    add: (input) => run(() => api.createTask(input)),
    move: (id, status) => run(() => api.moveTask(id, status)),
    reorder: (id, status, ordered) => {
      // Update optimistis agar kartu tidak "loncat balik" sebelum backend selesai
      set((s) => ({
        tasks: s.tasks.map((t) => {
          if (t.id === id) t = { ...t, status };
          const i = ordered.indexOf(t.id);
          return i >= 0 && t.status === status ? { ...t, sortOrder: i } : t;
        }),
      }));
      return run(() => api.reorderTask(id, status, ordered));
    },
    remove: (id) => run(() => api.deleteTask(id)),
  };
});