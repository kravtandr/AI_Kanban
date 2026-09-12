import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import ProjectManager from "./ProjectManager";

afterEach(() => vi.restoreAllMocks());
it("restores an archived project through the existing API", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify([{ id: 7, name: "Archived", description: "", color: "#aaaaaa", archived_at: "2026-01-01", is_inbox: false, active_tasks: 0 }]), { status: 200 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><ProjectManager onClose={() => {}} /></QueryClientProvider>);
  await userEvent.click(await screen.findByRole("button", { name: "Восстановить Archived" }));
  await waitFor(() => expect(fetch.mock.calls.some(([url, options]) => String(url).endsWith("/projects/7") && options?.method === "PATCH" && JSON.parse(String(options.body)).archived === false)).toBe(true));
});
