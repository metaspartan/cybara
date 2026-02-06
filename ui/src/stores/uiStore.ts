import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Toast } from '../types';

// Theme accent presets
export type ThemeAccent = 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan' | 'purple' | 'blue' | 'teal' | 'orange' | 'pink';

export const themeAccents: Record<ThemeAccent, { primary: string; name: string }> = {
  indigo: { primary: '99, 102, 241', name: 'Indigo' },
  blue: { primary: '59, 130, 246', name: 'Blue' },
  cyan: { primary: '6, 182, 212', name: 'Cyan' },
  teal: { primary: '20, 184, 166', name: 'Teal' },
  emerald: { primary: '16, 185, 129', name: 'Emerald' },
  amber: { primary: '245, 158, 11', name: 'Amber' },
  orange: { primary: '249, 115, 22', name: 'Orange' },
  rose: { primary: '244, 63, 94', name: 'Rose' },
  pink: { primary: '236, 72, 153', name: 'Pink' },
  purple: { primary: '168, 85, 247', name: 'Purple' },
};

interface UIState {
  // Theme
  accent: ThemeAccent;
  setAccent: (accent: ThemeAccent) => void;

  // Loading states
  loading: Record<string, boolean>;
  setLoading: (key: string, value: boolean) => void;

  // Toast notifications
  toasts: Toast[];
  addToast: (type: Toast['type'], message: string) => void;
  removeToast: (id: string) => void;

  // Modal states
  activeModal: string | null;
  modalData: unknown;
  openModal: (modal: string, data?: unknown) => void;
  closeModal: () => void;

  // Sidebar state
  sidebarOpen: boolean;
  toggleSidebar: () => void;
}

// Apply theme CSS variables
const applyTheme = (accent: ThemeAccent) => {
  const colors = themeAccents[accent];
  document.documentElement.style.setProperty('--accent-primary', colors.primary);
};

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      accent: 'indigo',
      setAccent: (accent) => {
        applyTheme(accent);
        set({ accent });
      },

      loading: {},
      setLoading: (key, value) =>
        set((state) => ({
          loading: { ...state.loading, [key]: value }
        })),

      toasts: [],
      addToast: (type, message) => {
        const id = Math.random().toString(36).slice(2);
        set((state) => ({
          toasts: [...state.toasts, { id, type, message }]
        }));
        setTimeout(() => {
          set((state) => ({
            toasts: state.toasts.filter((t) => t.id !== id)
          }));
        }, 5000);
      },
      removeToast: (id) =>
        set((state) => ({
          toasts: state.toasts.filter((t) => t.id !== id)
        })),

      activeModal: null,
      modalData: null,
      openModal: (modal, data) => set({ activeModal: modal, modalData: data }),
      closeModal: () => set({ activeModal: null, modalData: null }),

      sidebarOpen: true,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
    }),
    {
      name: 'cybara-ui-settings',
      partialize: (state) => ({ accent: state.accent }),
      onRehydrateStorage: () => (state) => {
        if (state?.accent) applyTheme(state.accent);
      },
    }
  )
);
