import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Автофокус только на десктопе: на мобильном выехавшая клавиатура
  // закрыла бы половину формы ещё до того, как её увидели.
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) usernameRef.current?.focus();
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(username, password);
      // Только внутренние пути: "//host" и абсолютные URL — открытый редирект
      const next = params.get("next");
      const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/board";
      navigate(safeNext, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
      // Возвращаем фокус в первое поле — иначе он остаётся на кнопке
      // и до сообщения об ошибке ещё надо доехать табом
      usernameRef.current?.focus();
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
            ref={usernameRef}
            name="username"
            autoComplete="username"
            spellCheck={false}
            autoCapitalize="none"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            aria-invalid={error ? true : undefined}
            className="input py-2.5"
          />
        </label>
        <label className="mb-6 block">
          <span className="eyebrow">Пароль</span>
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={error ? true : undefined}
            className="input py-2.5"
          />
        </label>
        {/* Смонтирована всегда: живая область, приходящая вместе с текстом,
          скринридером не зачитывается. */}
        <div aria-live="polite">
          {error && <p className="mb-4 text-sm text-danger">{error}</p>}
        </div>
        <button type="submit" disabled={busy} className="btn-primary w-full py-2.5">
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </div>
  );
}
