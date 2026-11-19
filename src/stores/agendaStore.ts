import { create } from "zustand";
import { api } from "../lib/api";
import type { Agenda, AgendaInput } from "../lib/api";

interface AgendaState {
  agendas: Agenda[];
  load: () => Promise<void>;
  save: (input: AgendaInput, id?: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

// save/remove melempar error agar form bisa menampilkannya.
export const useAgendaStore = create<AgendaState>((set, get) => ({
  agendas: [],
  load: async () => {
    try {
      set({ agendas: await api.listAgendas() });
    } catch (e) {
      console.error(e);
    }
  },
  save: async (input, id) => {
    if (id) await api.updateAgenda(id, input);
    else await api.createAgenda(input);
    await get().load();
  },
  remove: async (id) => {
    await api.deleteAgenda(id);
    await get().load();
  },
}));