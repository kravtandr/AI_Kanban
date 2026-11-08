import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import BudgetPage from "./BudgetPage";

afterEach(() => vi.unstubAllGlobals());

function renderBudget() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <BudgetPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Бюджет", () => {
  it("считает все цели от зарплаты и нескольких заказов, сохраняет суммы в копейках", async () => {
    const saved = { salary: 10_000_000, freelance: [{ title: "Лендинг", amount: 2_000_000 }] };
    const fetch = vi.fn(async (_url: string, options?: RequestInit) =>
      Response.json(options?.body ? JSON.parse(String(options.body)) : saved),
    );
    vi.stubGlobal("fetch", fetch);
    renderBudget();
    const user = userEvent.setup();

    expect(await screen.findByLabelText("Зарплата, ₽")).toHaveValue("100000");
    await user.click(screen.getByRole("button", { name: "Добавить поступление" }));
    await user.type(screen.getByLabelText("Заказ 2"), "Дизайн");
    await user.type(screen.getByLabelText("Сумма заказа 2, ₽"), "5 000,01");

    const monthly = within(screen.getByRole("group", { name: "На месяц" }));
    const longTerm = within(screen.getByRole("group", { name: "Долгосрочные цели" }));
    expect(monthly.getByText("25 000 ₽")).toBeInTheDocument();
    expect(monthly.getByText("37 500 ₽")).toBeInTheDocument();
    expect(monthly.getByText("62 500,01 ₽")).toBeInTheDocument();
    expect(longTerm.getByText("750 000,06 ₽")).toBeInTheDocument();
    expect(longTerm.getByText("15 000 001,20 ₽")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Сохранить месяц" }));
    expect(await screen.findByText("Сохранено")).toBeInTheDocument();
    expect(fetch).toHaveBeenLastCalledWith(expect.stringMatching(/\/api\/v1\/budget\/\d{4}-\d{2}$/), expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        salary: 10_000_000,
        freelance: [...saved.freelance, { title: "Дизайн", amount: 500_001 }],
      }),
    }));
  });

  it("загружает бюджет другого месяца и возвращается к сохранённым данным", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => Response.json({
      salary: url.endsWith("2026-10") ? 9_000_000 : 0,
      freelance: [],
    })));
    renderBudget();
    const month = screen.getByLabelText("Месяц бюджета");
    fireEvent.change(month, { target: { value: "2026-10" } });
    expect(await screen.findByDisplayValue("90000")).toBeInTheDocument();
    fireEvent.change(month, { target: { value: "2026-11" } });
    expect(await screen.findByDisplayValue("")).toHaveAccessibleName("Зарплата, ₽");
    fireEvent.change(month, { target: { value: "2026-10" } });
    expect(await screen.findByDisplayValue("90000")).toBeInTheDocument();
  });
});
