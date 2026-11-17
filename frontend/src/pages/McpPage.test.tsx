import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api";
import McpPage from "./McpPage";
import type { McpTool } from "../types";

const tools: McpTool[] = [
  {
    name: "get_task",
    description: "Read by ID",
    inputSchema: {
      properties: { task_id: { type: "integer" } },
      required: ["task_id"],
    },
  },
  { name: "list_expenses", description: "Read expenses", inputSchema: {} },
  {
    name: "save_budget",
    description: "Replace budget",
    inputSchema: {
      properties: {
        month: { type: "string" },
        salary: { type: "integer" },
        freelance: { type: "array" },
      },
      required: ["month", "salary", "freelance"],
    },
  },
];

afterEach(() => vi.restoreAllMocks());

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter initialEntries={["/integrations/mcp"]}>
        <McpPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("фильтрует по русскому описанию, разделу и имени, показывает параметры", async () => {
  vi.spyOn(api, "mcpTools").mockResolvedValue(tools);
  const user = userEvent.setup();
  mount();
  expect(screen.getByRole("link", { name: "MCP" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await user.click(
    await screen.findByRole("button", { name: /Получить задачу/ }),
  );
  expect(within(screen.getByRole("table")).getByText("task_id")).toBeVisible();
  await user.click(screen.getByRole("button", { name: /^Бюджет/ }));
  expect(
    screen.getByRole("heading", { name: "Сохранить бюджет" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /Получить задачу/ }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^Все инструменты/ }));
  await user.type(screen.getByRole("searchbox"), "список трат");
  expect(screen.getByRole("heading", { name: "Список трат" })).toBeVisible();
  expect(screen.queryByText("task_id")).not.toBeInTheDocument();
  await user.clear(screen.getByRole("searchbox"));
  await user.type(screen.getByRole("searchbox"), "xxx");
  expect(screen.getByText("Инструменты не найдены.")).toBeVisible();
});

it("даёт скопировать JSON-вызов и настройки подключения", async () => {
  vi.spyOn(api, "mcpTools").mockResolvedValue(tools);
  const user = userEvent.setup();
  mount();
  await user.click(
    await screen.findByRole("button", { name: /Сохранить бюджет/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Копировать JSON-вызов" }),
  );
  const call = JSON.parse(await navigator.clipboard.readText());
  expect(call.method).toBe("tools/call");
  expect(call.params.name).toBe("save_budget");
  expect(call.params.arguments).toHaveProperty("salary");
  await user.click(screen.getByRole("button", { name: "Подключение" }));
  await user.click(screen.getByRole("button", { name: "JSON" }));
  await user.click(
    screen.getByRole("button", { name: "Копировать настройки" }),
  );
  const config = JSON.parse(await navigator.clipboard.readText());
  expect(config.mcpServers.tasktracker.type).toBe("http");
  expect(config.mcpServers.tasktracker.headers.Authorization).toContain(
    "<MCP_TOKEN>",
  );
});

it("показывает ошибку каталога и повторяет загрузку", async () => {
  const getTools = vi
    .spyOn(api, "mcpTools")
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(tools);
  const user = userEvent.setup();
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Не удалось загрузить инструменты.",
  );
  await user.click(screen.getByRole("button", { name: "Повторить" }));
  expect(
    await screen.findByRole("button", { name: /Получить задачу/ }),
  ).toBeVisible();
  expect(getTools).toHaveBeenCalledTimes(2);
});

it("копирует настройки при недоступном Clipboard API в HTTP LAN", async () => {
  vi.spyOn(api, "mcpTools").mockResolvedValue(tools);
  const user = userEvent.setup();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("insecure context"),
  );
  const legacyCopy = vi.fn(() => true);
  Object.defineProperty(document, "execCommand", {
    value: legacyCopy,
    configurable: true,
  });
  try {
    mount();
    await user.click(screen.getByRole("button", { name: "Подключение" }));
    await user.click(
      screen.getByRole("button", { name: "Копировать адрес сервера" }),
    );
    expect(legacyCopy).toHaveBeenCalledWith("copy");
    expect(screen.getByRole("status")).toHaveTextContent("Скопировано");
    expect(document.querySelector("textarea")).toBeNull();
  } finally {
    Reflect.deleteProperty(document, "execCommand");
  }
});
