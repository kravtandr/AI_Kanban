import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Expense } from "../types";
import ExpenseCharts from "./ExpenseCharts";

const REC: Expense = {
  id: 1, title: "Интернет", note: "", amount: 90000, status: "recurring", period: "month",
  anchor_date: "2026-01-31", active: true, purchased_at: null, tags: [], sort_order: 1,
  source: "manual", created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
  next_charge: "2026-09-30",
};

describe("ExpenseCharts", () => {
  it("shows a monthly breakdown and opens the selected expense using the keyboard", async () => {
    const onOpen = vi.fn();
    render(<ExpenseCharts expenses={[REC]} onOpen={onOpen} today={new Date(2026, 8, 17)} />);
    const chart = screen.getByRole("region", { name: "Структура трат" });
    expect(within(chart).getByRole("img", { name: /900.*₽/ })).toBeInTheDocument();
    const item = within(chart).getByRole("button", { name: /Интернет/ });
    item.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenCalledWith(REC);
  });

  it("navigates across years, clamps payment dates and returns to the current month", async () => {
    render(<ExpenseCharts expenses={[REC]} onOpen={() => {}} today={new Date(2026, 0, 17)} />);
    const calendar = screen.getByRole("region", { name: "Календарь оплат" });
    await userEvent.click(within(calendar).getByRole("button", { name: "Следующий месяц" }));
    expect(within(calendar).getByRole("button", { name: /Интернет.*28 февраля 2026.*900/ })).toBeInTheDocument();
    await userEvent.click(within(calendar).getByRole("button", { name: "Предыдущий месяц" }));
    await userEvent.click(within(calendar).getByRole("button", { name: "Предыдущий месяц" }));
    expect(within(calendar).getByText("декабрь 2025")).toBeInTheDocument();
    expect(within(calendar).queryByRole("button", { name: /Интернет.*31 декабря/ })).toBeNull();
    await userEvent.click(within(calendar).getByRole("button", { name: "Текущий месяц" }));
    expect(within(calendar).getByRole("button", { name: /Интернет.*31 января 2026/ })).toBeInTheDocument();
  });

  it("counts every daily payment in the chosen month and opens its marker", () => {
    const daily = { ...REC, period: "day" as const, anchor_date: "2026-09-28", amount: 10000 };
    const onOpen = vi.fn();
    render(<ExpenseCharts expenses={[daily]} onOpen={onOpen} today={new Date(2026, 8, 17)} />);
    const calendar = screen.getByRole("region", { name: "Календарь оплат" });
    expect(within(calendar).getByText("300 ₽")).toBeInTheDocument();
    const payment = within(calendar).getByRole("button", { name: /Интернет.*29 сентября 2026.*100/ });
    fireEvent.click(payment);
    expect(onOpen).toHaveBeenCalledWith(daily);
  });

  it("shows empty states and excludes paused expenses even when the board includes them", () => {
    render(<ExpenseCharts expenses={[{ ...REC, active: false }]} onOpen={() => {}} />);
    expect(screen.getByText("Нет регулярных трат")).toBeInTheDocument();
    expect(screen.getByText("В этом месяце списаний нет")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Интернет/ })).toBeNull();
  });

  it("keeps free expenses in the calendar without drawing a zero-value slice", () => {
    render(<ExpenseCharts expenses={[{ ...REC, amount: 0 }]} onOpen={() => {}} today={new Date(2026, 8, 17)} />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: /Интернет.*30 сентября 2026.*0/ })).toBeInTheDocument();
  });
});
