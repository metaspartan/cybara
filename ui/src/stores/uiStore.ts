import { create } from 'zustand';
import type { Toast } from '../types';

interface UIState {
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

export const useUIStore = create<UIState>((set) => ({
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
}));
