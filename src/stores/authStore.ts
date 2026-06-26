import { create } from "zustand";
import { persist } from "zustand/middleware";
import api from "@/lib/api";
import type { User, LoginCredentials, RegisterData, AuthResponse } from "@/types/auth";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
  clearError: () => void;
  updateUser: (user: User) => void;
  setAuth: (user: User, token: string) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (credentials) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post<AuthResponse>("/auth/login", credentials);
          const { user, token } = res.data;
          localStorage.setItem("auth_token", token);
          set({ user, token, isAuthenticated: true, isLoading: false });
        } catch (err: any) {
          set({ error: err.response?.data?.message ?? "Error al iniciar sesión", isLoading: false });
          throw err;
        }
      },

      register: async (data) => {
        set({ isLoading: true, error: null });
        try {
          const res = await api.post<AuthResponse>("/auth/register", data);
          const { user, token } = res.data;
          localStorage.setItem("auth_token", token);
          set({ user, token, isAuthenticated: true, isLoading: false });
        } catch (err: any) {
          set({ error: err.response?.data?.message ?? "Error al registrarse", isLoading: false });
          throw err;
        }
      },

      logout: () => {
        localStorage.removeItem("auth_token");
        set({ user: null, token: null, isAuthenticated: false });
      },

      checkAuth: async () => {
        const token = localStorage.getItem("auth_token");
        if (!token) { set({ isLoading: false }); return; }
        set({ isLoading: true });
        try {
          const res = await api.get<{ user: User }>("/auth/me");
          set({ user: res.data.user, token, isAuthenticated: true, isLoading: false });
        } catch {
          localStorage.removeItem("auth_token");
          set({ user: null, token: null, isAuthenticated: false, isLoading: false });
        }
      },

      clearError: () => set({ error: null }),

      updateUser: (user) => set({ user }),

      setAuth: (user, token) => {
        localStorage.setItem("auth_token", token);
        set({ user, token, isAuthenticated: true });
      },
    }),
    { name: "auth-storage" }
  )
);
