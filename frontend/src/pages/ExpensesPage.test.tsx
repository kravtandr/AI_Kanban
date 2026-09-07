import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Expense, ExpenseSummary } from "../types";
import ExpensesPage from "./ExpensesPage";

vi.mock("../lib/useDictation", () => ({
  useDictation: () => ({ supported: false, recording: false, error: null, start: () => {}, stop: () => {} }),
  appendTranscript: (a: string, b: string) => `${a} ${b}`,
}));

const REC: Expense = {
  id: 1, title: "Netflix", note: "", amount: 89900, status: "recurring", period: "month",
  anchor_date: "2026-01-15", active: true, purchased_at: null, tags: [], sort_order: 1,
  source: "manual", created_at: "2026-09-01T00:00:00", updated_at: "2026-09-01T00:00:00",
  next_charge: "2026-09-15",
};
const WANT: Expense = { ...REC, id: 2, title: "Монитор", status: "wanted", period: null,
  anchor_date: null, amount: 3500000, next_charge: null };
const PAUSED: Expense = { ...REC, id: 3, title: "Спортзал", active: false, next_charge: null };

const SUMMARY: ExpenseSummary = {
  monthly_recurring: 89900, upcoming: [], upcoming_total: 0, wanted_total: 3500000,
  bought_this_month: 0, currency: "RUB",
};

function renderPage(path = "/expenses") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ExpensesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ExpensesPage", () => {
  it("рисует три колонки, карточки по статусам и итоги", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([REC, WANT]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage();
    await waitFor(() => expect(screen.getByText("Netflix")).toBeInTheDocument());
    expect(screen.getByText("Монитор")).toBeInTheDocument();
    for (const title of ["Регулярные", "Хочу купить", "Куплено"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    const wantCard = screen.getByRole("button", { name: /Монитор/ });
    expect(within(wantCard).getByText("35 000 ₽")).toBeInTheDocument();
  });

  it("?inactive=1 запрашивает include_inactive и показывает паузу", async () => {
    const list = vi.spyOn(api, "expenses").mockResolvedValue([REC, PAUSED]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage("/expenses?inactive=1");
    await waitFor(() => expect(screen.getByText("Спортзал")).toBeInTheDocument());
    expect(list.mock.calls[0][0].get("include_inactive")).toBe("true");
    expect(screen.getByText("пауза")).toBeInTheDocument();
  });

  it("?expense=2 открывает модалку карточки", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([REC, WANT]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage("/expenses?expense=2");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByLabelText("Название")).toHaveValue("Монитор");
  });

  it("ошибка итогов не ломает колонки", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([WANT]);
    vi.spyOn(api, "expenseSummary").mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Монитор")).toBeInTheDocument());
    expect(screen.queryByText(/в месяц/)).toBeNull();
  });
});
