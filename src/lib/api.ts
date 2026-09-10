import axios from "axios";

const rawBaseURL = String(import.meta.env.VITE_API_URL || "/api").replace(/["']+/g, "").replace(/\/+$/, "");
const api = axios.create({
  baseURL: rawBaseURL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.data?.code === "CONSENT_REQUIRED" && !window.location.pathname.startsWith("/admin")) {
      const returnTo = window.location.pathname + window.location.search;
      window.location.href = `/app/consent?returnTo=${encodeURIComponent(returnTo)}`;
    }
    if (err.response?.status === 401) {
      localStorage.removeItem("auth_token");
      const path = window.location.pathname;
      if (path.startsWith("/app") || path.startsWith("/admin") || path.startsWith("/coach")) {
        window.location.href = "/auth/login";
      }
    }
    return Promise.reject(err);
  }
);

export default api;
