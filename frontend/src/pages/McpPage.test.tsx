import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import { api } from "../api";
import McpPage from "./McpPage";

it("фильтрует инструменты и показывает их параметры", async () => {
  vi.spyOn(api, "mcpTools").mockResolvedValue([
    { name: "get_task", description: "Read by ID", inputSchema: {
      properties: { task_id: { type: "integer" } }, required: ["task_id"],
    } },
    { name: "list_expenses", description: "Read expenses", inputSchema: {} },
  ]);
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/integrations/mcp"]}><McpPage /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByRole("link", { name: "MCP" })).toHaveAttribute("aria-current", "page");
  await user.click(await screen.findByText("get_task"));
  expect(within(screen.getByRole("table")).getByText("task_id")).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "expenses");
  expect(screen.queryByText("get_task")).not.toBeInTheDocument();
  expect(screen.getByText("list_expenses")).toBeVisible();
  await user.type(screen.getByRole("searchbox"), "xxx");
  expect(screen.getByText("Инструменты не найдены.")).toBeVisible();
});
