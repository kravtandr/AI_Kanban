import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password);
      navigate(params.get("next") ?? "/board", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-edge bg-surface p-8 shadow-2xl"
      >
        <h1 className="mb-1 font-mono text-xl font-medium">
          <span className="caret">tasktracker</span>
        </h1>
        <p className="mb-7 text-sm text-dim">Доска для вас и ваших агентов</p>
        <label className="mb-3 block">
          <span className="eyebrow">Логин</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            className="input py-2.5"
          />
        </label>
        <label className="mb-6 block">
          <span className="eyebrow">Пароль</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="input py-2.5"
          />
        </label>
        {error && <p className="mb-4 text-sm text-danger">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
