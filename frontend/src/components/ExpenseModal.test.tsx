import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Expense } from "../types";
import ExpenseModal from "./ExpenseModal";

const EXPENSE: Expense = {
  id: 5, title: "Netflix", note: "", amount: 89900, status: "recurring", period: "month",
  anchor_date: "2026-01-15", active: true, purchased_at: null, tags: [], sort_order: 1,
  source: "manual", created_at: "2026-09-01T00:00:00", updated_at: "2026-09-01T00:00:00",
  next_charge: "2026-09-15",
};

function renderModal(expense = EXPENSE) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpenseModal expense={expense} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

afterEach(() => vi.restoreAllMocks());

describe("ExpenseModal", () => {
  it("PATCH шлёт только изменённые поля, рубли → копейки", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, amount: 99900 });
    const onClose = renderModal();
    const amount = screen.getByLabelText("Сумма, ₽");
    await userEvent.clear(amount);
    await userEvent.type(amount, "999");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(5, { amount: 99900 }));
    expect(onClose).toHaveBeenCalled();
  });

  it("смена регулярной на «хочу» шлёт status и clear_period", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, status: "wanted" });
    renderModal();
    await userEvent.click(screen.getByRole("radio", { name: "Хочу купить" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(5, { status: "wanted", clear_period: true }),
    );
  });

  it("неверная сумма — инлайн-ошибка, запроса нет", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    renderModal();
    const amount = screen.getByLabelText("Сумма, ₽");
    await userEvent.clear(amount);
    await userEvent.type(amount, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByText("Введите сумму в рублях")).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it("кнопка «Куплено» у wanted вызывает move", async () => {
    const move = vi.spyOn(api, "moveExpense").mockResolvedValue({ ...EXPENSE, status: "bought" });
    renderModal({ ...EXPENSE, status: "wanted", period: null, anchor_date: null, next_charge: null });
    await userEvent.click(screen.getByRole("button", { name: "Куплено" }));
    await waitFor(() => expect(move).toHaveBeenCalledWith(5, "bought"));
  });
});
