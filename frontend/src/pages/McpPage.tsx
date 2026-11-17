import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import NavTabs from "../components/NavTabs";
import type { McpTool } from "../types";

const TOKEN_COMMAND = "docker compose exec app python -m app.cli create-token claude-code --kind mcp";

const COVERAGE = [
  {
    section: "Задачи",
    status: "Основные операции",
    tone: "text-mcp",
    description: "Поиск, создание, правки, статусы, удаление и статистика. Проекты можно просматривать, но управлять ими отдельно через MCP нельзя.",
  },
  {
    section: "Траты",
    status: "Частичное покрытие",
    tone: "text-amber",
    description: "Список, создание, правки и сводка. Правками можно ставить подписки на паузу и отмечать покупки. Удаления и ручной сортировки нет.",
  },
  {
    section: "Бюджет",
    status: "Только в веб-интерфейсе",
    tone: "text-dim",
    description: "Зарплата, фриланс и цели за месяц. Сводка трат содержит расходы и ближайшие списания.",
  },
];

function CopyBlock({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState("");

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setFeedback("Скопировано");
    } catch {
      setFeedback("Выделите и скопируйте текст вручную");
    }
  }

  return (
    <div className="min-w-0 rounded-lg border border-edge bg-night">
      <div className="flex flex-wrap items-center justify-between gap-x-3 border-b border-edge px-3">
        <span className="py-2 text-sm text-dim">{label}</span>
        <button
          type="button"
          className="min-h-9 rounded px-2 text-xs text-mcp hover:bg-mcp/10"
          aria-label={`Копировать: ${label}`}
          onClick={() => void copy()}
        >
          Копировать
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed"><code>{value}</code></pre>
      {feedback && <p role="status" className="px-3 pb-2 text-xs text-mcp">{feedback}</p>}
    </div>
  );
}

function ToolDetails({ tool }: { tool: McpTool }) {
  const parameters = Object.entries(tool.inputSchema.properties ?? {});
  return (
    <details className="group border-b border-edge last:border-b-0">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 hover:bg-panel [&::-webkit-details-marker]:hidden">
        <code className="min-w-0 break-all text-sm text-mcp">{tool.name}</code>
        <span className="shrink-0 font-mono text-sm text-dim group-open:rotate-90" aria-hidden="true">›</span>
      </summary>
      <div className="space-y-3 px-4 pb-4">
        {tool.description && <p className="text-sm leading-relaxed text-dim">{tool.description}</p>}
        {parameters.length > 0 ? (
          <>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-edge text-dim">
                <tr><th scope="col" className="py-2">Параметр</th><th scope="col" className="py-2">Ввод</th></tr>
              </thead>
              <tbody>
                {parameters.map(([name, schema]) => (
                  <tr key={name} className="border-b border-edge/60 align-top">
                    <td className="py-2 pr-3">
                      <code className="break-all">{name}</code>
                      {schema.description && <p className="mt-1 text-dim">{schema.description}</p>}
                    </td>
                    <td className="py-2 text-dim">
                      {tool.inputSchema.required?.includes(name) ? "Обязательный" : "Необязательный"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details>
              <summary className="w-fit cursor-pointer text-xs text-mcp">JSON Schema</summary>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-night p-3 text-xs">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </details>
          </>
        ) : <p className="text-xs text-dim">Без параметров</p>}
      </div>
    </details>
  );
}

export default function McpPage() {
  const [search, setSearch] = useState("");
  const catalog = useQuery({ queryKey: ["mcp-tools"], queryFn: api.mcpTools });
  const endpoint = new URL("/mcp", window.location.origin).href;
  const connect = `claude mcp add --transport http tasktracker '${endpoint}' \\\n  --header 'Authorization: Bearer <MCP_TOKEN>'`;
  const query = search.trim().toLowerCase();
  const tools = catalog.data?.filter((tool) =>
    `${tool.name} ${tool.description ?? ""}`.toLowerCase().includes(query),
  );

  function logout() {
    void api.logout().catch(() => undefined).finally(() => window.location.assign("/login"));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge/70 bg-surface p-3 md:px-5">
        <h1 className="shrink-0 font-mono text-base font-medium"><span className="caret">tasktracker</span></h1>
        <NavTabs />
        <button type="button" onClick={logout} className="ml-auto font-mono text-xs text-dim hover:text-ink">выйти</button>
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-6 p-3 sm:p-6">
          <section className="rounded-xl border border-edge border-l-2 border-l-mcp bg-surface p-5 sm:p-7" aria-labelledby="mcp-title">
            <h2 id="mcp-title" className="font-mono text-3xl font-medium tracking-tight sm:text-4xl">MCP TaskTracker</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim sm:text-base">
              Подключите AI-агента через Model Context Protocol, чтобы работать с задачами и тратами из MCP-клиента.
            </p>
            <div className="mt-5 max-w-xl">
              <CopyBlock label="Адрес сервера · Streamable HTTP" value={endpoint} />
            </div>
          </section>

          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="min-w-0 space-y-6">
              <section aria-labelledby="mcp-connect" className="space-y-3">
                <h3 id="mcp-connect" className="text-xl font-semibold">Подключение</h3>
                <ol className="list-decimal space-y-4 pl-5 text-sm">
                  <li className="space-y-2 pl-1 marker:text-mcp">
                    <p>Создайте MCP-токен на сервере в каталоге Docker Compose.</p>
                    <CopyBlock label="Команда для сервера" value={TOKEN_COMMAND} />
                  </li>
                  <li className="space-y-2 pl-1 marker:text-mcp">
                    <p>На компьютере в локальной сети подставьте токен вместо <code>&lt;MCP_TOKEN&gt;</code> и выполните команду.</p>
                    <CopyBlock label="Claude Code" value={connect} />
                  </li>
                  <li className="pl-1 marker:text-mcp">
                    Проверьте подключение командой <code className="text-mcp">/mcp</code> внутри Claude Code.
                  </li>
                </ol>
                <p className="text-sm leading-relaxed text-dim">
                  Для другого клиента выберите Streamable HTTP и укажите заголовок{" "}
                  <code className="break-words text-ink">Authorization: Bearer &lt;MCP_TOKEN&gt;</code>.
                  Для HTTPS с внутренним сертификатом Caddy клиенту нужно доверять его центру сертификации.
                </p>
              </section>

              <section aria-labelledby="mcp-coverage" className="space-y-3">
                <h3 id="mcp-coverage" className="text-xl font-semibold">Что доступно</h3>
                <dl className="divide-y divide-edge border-y border-edge">
                  {COVERAGE.map(({ section, status, tone, description }) => (
                    <div key={section} className="space-y-1 py-3">
                      <dt className="flex flex-wrap items-baseline justify-between gap-x-2">
                        <span className="font-medium">{section}</span>
                        <span className={`text-xs ${tone}`}>{status}</span>
                      </dt>
                      <dd className="text-sm leading-relaxed text-dim">{description}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            </div>

            <section aria-labelledby="mcp-tools" className="min-w-0 rounded-xl border border-edge bg-surface">
              <div className="space-y-3 border-b border-edge p-4 sm:p-5">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 id="mcp-tools" className="text-xl font-semibold">Инструменты</h3>
                  {tools && <p role="status" className="font-mono text-xs text-dim">{tools.length} из {catalog.data?.length}</p>}
                </div>
                <input
                  aria-label="Поиск инструментов"
                  type="search"
                  className="input"
                  placeholder="Поиск по имени или описанию"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              {catalog.isPending && <p role="status" className="p-4 text-sm text-dim">Загружаем инструменты…</p>}
              {catalog.isError && (
                <div role="alert" className="p-4 text-sm text-dim">
                  Не удалось загрузить инструменты.
                  <button type="button" className="btn-ghost ml-1" onClick={() => void catalog.refetch()}>Повторить</button>
                </div>
              )}
              {tools?.length === 0 && <p className="p-4 text-sm text-dim">Инструменты не найдены.</p>}
              {tools?.map((tool) => <ToolDetails key={tool.name} tool={tool} />)}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
