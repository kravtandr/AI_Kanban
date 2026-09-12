import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import BoardPage from "./BoardPage";

const task = { id: 1, project_id: 1, title: "First", description: "", status: "todo", priority: "medium", tags: [], due_date: null, sort_order: 1, source: "manual", created_at: "2026-01-01", updated_at: "2026-01-01", completed_at: null };
const other = { ...task, id: 2, title: "Second", sort_order: 2 };
vi.mock("@dnd-kit/core", async (original) => {
  const actual = await original<typeof import("@dnd-kit/core")>();
  return { ...actual, DndContext: (props: React.ComponentProps<typeof actual.DndContext>) => <actual.DndContext {...props}>
    <button onClick={() => props.onDragEnd?.({ active: { id: "task-1", data: { current: { task } } }, over: { id: "task-2", data: { current: { task: other } } } } as never)}>Reorder</button>
    {props.children}
  </actual.DndContext> };
});
afterEach(() => vi.restoreAllMocks());
it("persists moving a task within the same column", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => new Response(JSON.stringify(String(input).endsWith("/projects") ? [] : [task, other]), { status: 200 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><MemoryRouter><BoardPage /></MemoryRouter></QueryClientProvider>);
  await screen.findByText("First");
  fireEvent.click(screen.getByText("Reorder"));
  await waitFor(() => {
    const request = fetch.mock.calls.find(([url]) => String(url).endsWith("/tasks/1/move"));
    expect(request).toBeDefined();
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({ status: "todo", sort_order: 2 });
  });
});
