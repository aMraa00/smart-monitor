import { create } from 'zustand';

/**
 * Transient UI state: toasts, sidebar and the realtime connection badge.
 * Kept out of component state so a toast survives route changes.
 */
let toastId = 0;

export const useUiStore = create((set, get) => ({
  toasts: [],
  sidebarOpen: false,
  socketState: 'idle', // idle | connecting | online | offline

  toast(message, tone = 'info', timeoutMs = 4000) {
    const id = ++toastId;
    set({ toasts: [...get().toasts, { id, message, tone }] });
    if (timeoutMs > 0) {
      window.setTimeout(() => get().dismissToast(id), timeoutMs);
    }
    return id;
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setSidebar(open) {
    set({ sidebarOpen: open });
  },

  setSocketState(socketState) {
    set({ socketState });
  },
}));
