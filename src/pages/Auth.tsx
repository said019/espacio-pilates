import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "@/stores/authStore";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login({ email, password });
      navigate("/admin/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Credenciales inválidas");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-syne font-extrabold text-2xl text-foreground mb-2 text-center">
          Valiance Pilates<span className="text-primary">.</span>
        </h1>
        <p className="text-muted-foreground text-sm text-center mb-8">Panel de administración</p>
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          {error && (
            <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-lg">{error}</div>
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="bg-secondary border border-border rounded-xl px-4 py-3 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            required
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-secondary border border-border rounded-xl px-4 py-3 text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="bg-primary text-primary-foreground py-3 rounded-xl text-sm font-medium tracking-wider uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </form>
        <button
          onClick={() => navigate("/")}
          className="mt-6 text-muted-foreground text-xs w-full text-center hover:text-foreground transition-colors bg-transparent border-none cursor-pointer"
        >
          ← Volver al sitio
        </button>
      </div>
    </div>
  );
};

export default Auth;
