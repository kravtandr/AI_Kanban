import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import McpCopyButton from "../components/McpCopyButton";
import NavTabs from "../components/NavTabs";
import {
  MCP_GROUPS,
  PARAMETER_HINTS,
  schemaType,
  toolExample,
  toolInfo,
  type McpGroup,
} from "../lib/mcpCatalog";
import type { McpTool } from "../types";

function ToolPanel({ tool }: { tool: McpTool }) {
  const info = toolInfo(tool);
  const parameters = Object.entries(tool.inputSchema.properties ?? {});
  const [view, setView] = useState<"example" | "schema">("example");
  const snippet =
    view === "example"
      ? toolExample(tool)
      : JSON.stringify(tool.inputSchema, null, 2);

  return (
    <article className="mcp-tool-panel" aria-label={info.title}>
      <div className="mcp-tool-heading">
        <span className="mcp-section-name">{info.group}</span>
        <span className="mcp-effect" data-effect={info.effect}>
          {info.effect}
        </span>
        <h3>{info.title}</h3>
        <code className="mcp-tool-id">{tool.name}</code>
        <p>{info.description}</p>
      </div>
      <section className="mcp-parameters" aria-labelledby="mcp-parameters">
        <h4 id="mcp-parameters">
          Параметры <span>{parameters.length}</span>
        </h4>
        {parameters.length === 0 ? (
          <p className="py-4 text-sm text-dim">Вызывается без параметров.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="mcp-parameter-table">
              <thead>
                <tr>
                  <th scope="col">Имя и тип</th>
                  <th scope="col">Описание</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map(([name, schema]) => (
                  <tr key={name}>
                    <td>
                      <div>
                        <code>{name}</code>
                        {tool.inputSchema.required?.includes(name) && (
                          <span
                            className="mcp-required"
                            title="Обязательный параметр"
                          >
                            обязательный
                          </span>
                        )}
                      </div>
                      <span className="mcp-value-type">
                        {schemaType(schema)}
                      </span>
                    </td>
                    <td>
                      {PARAMETER_HINTS[name] ??
                        schema.description ??
                        "Параметр инструмента"}
                      {schema.default !== undefined && (
                        <span className="mcp-default">
                          По умолчанию{" "}
                          <code>{JSON.stringify(schema.default)}</code>
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="mcp-code-section" aria-label="Пример и схема">
        <div className="mcp-code-toolbar">
          <div className="mcp-view-switch">
            <button
              type="button"
              aria-pressed={view === "example"}
              onClick={() => setView("example")}
            >
              JSON-вызов
            </button>
            <button
              type="button"
              aria-pressed={view === "schema"}
              onClick={() => setView("schema")}
            >
              JSON Schema
            </button>
          </div>
          <McpCopyButton
            key={view}
            label={
              view === "example" ? "Копировать JSON-вызов" : "Копировать схему"
            }
            value={snippet}
          />
        </div>
        <pre>
          <code>{snippet}</code>
        </pre>
        <p className="mcp-example-hint">
          Замените значения примера своими данными перед вызовом в MCP-клиенте.
        </p>
      </section>
      <details className="mcp-server-description">
        <summary>Описание, которое видит агент</summary>
        <p>{tool.description}</p>
      </details>
    </article>
  );
}

function ConnectionPanel() {
  const [format, setFormat] = useState("Claude Code");
  const endpoint = new URL("/mcp", window.location.origin).href;
  const command = `claude mcp add --transport http tasktracker '${endpoint}' \\\n  --header 'Authorization: Bearer <MCP_TOKEN>'`;
  const json = JSON.stringify(
    {
      mcpServers: {
        tasktracker: {
          type: "http",
          url: endpoint,
          headers: { Authorization: "Bearer <MCP_TOKEN>" },
        },
      },
    },
    null,
    2,
  );

  return (
    <section
      className="mcp-connection-layout"
      aria-labelledby="mcp-connection-title"
    >
      <div className="mcp-connection-guide">
        <h3 id="mcp-connection-title">
          Подключите TaskTracker к своему агенту
        </h3>
        <p>
          Сервер использует Streamable HTTP и отдельный Bearer-токен. Компьютер
          с MCP-клиентом должен иметь доступ к локальной сети сервера.
        </p>
        <ol>
          <li>
            <strong>Создайте токен на сервере</strong>
            <p>
              Выполните в каталоге Docker Compose. Токен выводится один раз.
            </p>
            <pre>
              <code>
                docker compose exec app python -m app.cli create-token
                claude-code --kind mcp
              </code>
            </pre>
          </li>
          <li>
            <strong>Добавьте сервер в клиент</strong>
            <p>
              Скопируйте настройки и замените <code>&lt;MCP_TOKEN&gt;</code>{" "}
              полученным токеном.
            </p>
          </li>
          <li>
            <strong>Проверьте подключение</strong>
            <p>
              В Claude Code откройте <code>/mcp</code>. Клиент загрузит каталог
              инструментов сервера.
            </p>
          </li>
        </ol>
        <p>
          Для HTTPS с внутренним сертификатом Caddy добавьте его центр
          сертификации в доверенные на компьютере клиента.
        </p>
      </div>
      <div className="mcp-connection-config">
        <div className="mcp-endpoint">
          <span>Адрес сервера</span>
          <code>{endpoint}</code>
          <McpCopyButton label="Копировать адрес сервера" value={endpoint} />
        </div>
        <div className="mcp-code-section">
          <div className="mcp-code-toolbar">
            <div className="mcp-view-switch">
              {["Claude Code", "JSON"].map((label) => (
                <button
                  key={label}
                  type="button"
                  aria-pressed={format === label}
                  onClick={() => setFormat(label)}
                >
                  {label}
                </button>
              ))}
            </div>
            <McpCopyButton
              key={format}
              label="Копировать настройки"
              value={format === "JSON" ? json : command}
            />
          </div>
          <pre>
            <code>{format === "JSON" ? json : command}</code>
          </pre>
        </div>
        <div className="mcp-connection-facts">
          <div>
            <span>Транспорт</span>
            <strong>Streamable HTTP</strong>
          </div>
          <div>
            <span>Авторизация</span>
            <code>Authorization: Bearer &lt;MCP_TOKEN&gt;</code>
          </div>
          <div>
            <span>Путь</span>
            <code>/mcp</code>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function McpPage() {
  const catalog = useQuery({ queryKey: ["mcp-tools"], queryFn: api.mcpTools });
  const [search, setSearch] = useState("");
  const [group, setGroup] = useState<McpGroup>("Все инструменты");
  const [selectedName, setSelectedName] = useState("list_tasks");
  const [section, setSection] = useState<"catalog" | "connection">("catalog");
  const query = search.trim().toLowerCase();
  const allTools = catalog.data ?? [];
  const tools = allTools.filter((tool) => {
    const info = toolInfo(tool);
    return (
      (group === "Все инструменты" || info.group === group) &&
      `${tool.name} ${tool.description ?? ""} ${info.title} ${info.description}`
        .toLowerCase()
        .includes(query)
    );
  });
  const selected = tools.find((tool) => tool.name === selectedName) ?? tools[0];

  function logout() {
    void api
      .logout()
      .catch(() => undefined)
      .finally(() => window.location.assign("/login"));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge/70 bg-surface p-3 md:px-5">
        <h1 className="shrink-0 font-mono text-base font-medium">
          <span className="caret">tasktracker</span>
        </h1>
        <NavTabs />
        <button
          type="button"
          onClick={logout}
          className="ml-auto font-mono text-xs text-dim hover:text-ink"
        >
          выйти
        </button>
      </header>
      <main className="mcp-page">
        <div className="mcp-workspace">
          <div className="mcp-intro">
            <div>
              <div className="mcp-protocol">
                <span aria-hidden="true">⌘</span> Model Context Protocol
              </div>
              <h2>TaskTracker для ваших агентов</h2>
              <p>
                Задачи, проекты, траты и бюджет. Весь рабочий контекст через
                один MCP-сервер.
              </p>
            </div>
            <div className="mcp-transport">
              <code>/mcp</code>
              <span>Streamable HTTP</span>
              <span>Bearer-токен</span>
            </div>
          </div>

          <div className="mcp-section-tabs" aria-label="Информация MCP">
            <button
              type="button"
              aria-pressed={section === "catalog"}
              onClick={() => setSection("catalog")}
            >
              Каталог инструментов{" "}
              {catalog.data && <span>{catalog.data.length}</span>}
            </button>
            <button
              type="button"
              aria-pressed={section === "connection"}
              onClick={() => setSection("connection")}
            >
              Подключение
            </button>
          </div>

          {section === "connection" ? (
            <ConnectionPanel />
          ) : (
            <>
              {catalog.isPending && (
                <p role="status" className="mcp-message">
                  Загружаем инструменты…
                </p>
              )}
              {catalog.isError && (
                <div role="alert" className="mcp-message">
                  Не удалось загрузить инструменты.
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => void catalog.refetch()}
                  >
                    Повторить
                  </button>
                </div>
              )}
              {catalog.data && (
                <div className="mcp-catalog">
                  <aside
                    className="mcp-tool-browser"
                    aria-label="Каталог инструментов"
                  >
                    <label className="mcp-search">
                      <svg
                        viewBox="0 0 20 20"
                        width="17"
                        height="17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        aria-hidden="true"
                      >
                        <circle cx="8" cy="8" r="5" />
                        <path d="m12 12 5 5" />
                      </svg>
                      <input
                        type="search"
                        aria-label="Поиск инструментов"
                        placeholder="Найти инструмент…"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </label>
                    <div
                      className="mcp-groups"
                      aria-label="Разделы инструментов"
                    >
                      {MCP_GROUPS.map((label) => {
                        const count =
                          label === "Все инструменты"
                            ? allTools.length
                            : allTools.filter(
                                (tool) => toolInfo(tool).group === label,
                              ).length;
                        if (!count && label !== "Все инструменты") return null;
                        return (
                          <button
                            key={label}
                            type="button"
                            aria-pressed={group === label}
                            onClick={() => setGroup(label)}
                          >
                            {label}
                            <span>{count}</span>
                          </button>
                        );
                      })}
                    </div>
                    <div className="mcp-results-heading">
                      <span>Инструменты</span>
                      <span role="status">
                        {tools.length} из {allTools.length}
                      </span>
                    </div>
                    <div className="mcp-tool-list">
                      {tools.map((tool) => {
                        const info = toolInfo(tool);
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            aria-pressed={selected?.name === tool.name}
                            onClick={() => setSelectedName(tool.name)}
                          >
                            <span className="mcp-tool-list-title">
                              {info.title}
                            </span>
                            <code>{tool.name}</code>
                            <span
                              className="mcp-tool-list-arrow"
                              aria-hidden="true"
                            >
                              ›
                            </span>
                          </button>
                        );
                      })}
                      {tools.length === 0 && (
                        <p className="mcp-message">Инструменты не найдены.</p>
                      )}
                    </div>
                  </aside>
                  {selected && (
                    <ToolPanel key={selected.name} tool={selected} />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
