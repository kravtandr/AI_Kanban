import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import BoardPage from "./BoardPage";

const task = {
  id: 42, project_id: 1, title: "Hidden task", description: "", status: "done",
  priority: "medium", tags: [], due_date: null, sort_order: 1, source: "manual",
  created_at: "2026-01-01", updated_at: "2026-01-01", completed_at: "2026-01-01",
};

function mount(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}>
    <BoardPage />
  </MemoryRouter></QueryClientProvider>);
}

afterEach(() => vi.restoreAllMocks());

function stubApi() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    const body = url.endsWith("/projects") ? [{ id: 1, name: "Inbox", color: "#aaaaaa", description: "", is_inbox: true, archived_at: null, active_tasks: 0 }]
      : url.endsWith("/tasks/42") ? task : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
}

it("opens a linked task even when absent from the board filter", async () => {
  stubApi();
  mount("/board?q=unrelated&task=42");
  expect(await screen.findByDisplayValue("Hidden task")).toBeInTheDocument();
});

it("allows requesting older completed tasks", async () => {
  const fetch = stubApi();
  mount("/board");
  await userEvent.click(await screen.findByRole("button", { name: "Показать все завершённые" }));
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("all_done=true"))).toBe(true));
});

it("ignores invalid priority URL values instead of breaking board requests", async () => {
  const fetch = stubApi();
  mount("/board?priority=invalid");
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  expect(fetch.mock.calls.some(([url]) => String(url).includes("priority=invalid"))).toBe(false);
});

it("passes the tag filter from a shareable URL to the API", async () => {
  const fetch = stubApi();
  mount("/board?tag=home");
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).includes("tag=home"))).toBe(true));
});
