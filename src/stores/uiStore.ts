import { create } from "zustand";

interface UiState {
  editingId: string | null;
  edit: (id: string) => void;
  close: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  editingId: null,
  edit: (id) => set({ editingId: id }),
  close: () => set({ editingId: null }),
}));