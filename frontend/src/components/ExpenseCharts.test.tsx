import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Expense } from "../types";
import ExpenseCharts from "./ExpenseCharts";

const REC: Expense = {
  id: 1, title: "Интернет", note: "", amount: 90000, status: "recurring", period: "month",
  anchor_date: "2026-01-31", active: true, purchased_at: null, tags: [], sort_order: 1,
  source: "manual", created_at: "2026-01-01T00:00:00", updated_at: "2026-01-01T00:00:00",
  next_charge: "2026-09-30",
};

describe("ExpenseCharts", () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("collapses both charts with the keyboard, remembers it and preserves chart state", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ExpenseCharts expenses={[{ ...REC, tags: ["дом"] }]} onOpen={() => {}} today={new Date(2026, 0, 17)} />);
    await user.click(screen.getByRole("button", { name: "По тегам" }));
    await user.click(screen.getByRole("button", { name: "Следующий месяц" }));
    const toggle = screen.getByRole("button", { name: /Свернуть.*Структура трат и календарь оплат/ });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Структура трат" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Календарь оплат" })).toBeNull();
    await user.keyboard(" ");
    expect(screen.getByRole("button", { name: "По тегам" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("февраль 2026")).toBeVisible();
    await user.click(toggle);
    unmount();
    render(<ExpenseCharts expenses={[REC]} onOpen={() => {}} />);
    expect(screen.getByRole("button", { name: /Развернуть.*Структура трат и календарь оплат/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region", { name: "Календарь оплат" })).toBeNull();
    await user.click(screen.getByRole("button", { name: /Развернуть.*Структура трат и календарь оплат/ }));
    expect(screen.getByRole("region", { name: "Календарь оплат" })).toBeVisible();
  });

  it("still toggles when browser storage is unavailable", async () => {
    const get = vi.spyOn(window.localStorage, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    const set = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    try {
      render(<ExpenseCharts expenses={[REC]} onOpen={() => {}} />);
      await userEvent.click(screen.getByRole("button", { name: /Свернуть.*Структура трат и календарь оплат/ }));
      expect(screen.queryByRole("region", { name: "Структура трат" })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: /Развернуть.*Структура трат и календарь оплат/ }));
      expect(screen.getByRole("region", { name: "Структура трат" })).toBeVisible();
    } finally { get.mockRestore(); set.mockRestore(); }
  });

  it("switches to tag categories without double-counting and back to expenses", async () => {
    const onOpen = vi.fn();
    render(<ExpenseCharts expenses={[
      { ...REC, tags: ["дом", "связь"] },
      { ...REC, id: 2, title: "Аренда", amount: 100000, tags: ["дом"] },
      { ...REC, id: 3, title: "Без категории", amount: 10000 },
      { ...REC, id: 4, title: "Пауза", amount: 500000, tags: ["пауза"], active: false },
    ]} onOpen={onOpen} />);
    const chart = within(screen.getByRole("region", { name: "Структура трат" }));
    await userEvent.click(chart.getByRole("button", { name: "По тегам" }));
    expect(chart.getByRole("button", { name: "По тегам" })).toHaveAttribute("aria-pressed", "true");
    expect(chart.getByRole("img")).toHaveAccessibleName(/2.000.*₽/);
    expect(chart.getByRole("button", { name: /#дом.*1\s450.*72,5%/ })).toBeInTheDocument();
    expect(chart.getByRole("button", { name: /#связь.*450.*22,5%/ })).toBeInTheDocument();
    expect(chart.getByRole("button", { name: /Без тега.*100.*5%/ })).toBeInTheDocument();
    expect(chart.queryByText("#пауза")).toBeNull();
    await userEvent.click(chart.getByRole("button", { name: /#дом/ }));
    expect(onOpen).not.toHaveBeenCalled();
    await userEvent.click(chart.getByRole("button", { name: "По тратам" }));
    await userEvent.click(chart.getByRole("button", { name: /Интернет/ }));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("updates categories when tags or board filters change and keeps the chosen mode", async () => {
    const { rerender } = render(<ExpenseCharts expenses={[{ ...REC, tags: ["дом", "дом"] }]} onOpen={() => {}} />);
    const chart = within(screen.getByRole("region", { name: "Структура трат" }));
    await userEvent.click(chart.getByRole("button", { name: "По тегам" }));
    expect(chart.getByRole("button", { name: /#дом.*900.*100%/ })).toBeInTheDocument();
    rerender(<ExpenseCharts expenses={[{ ...REC, tags: ["работа"] }]} onOpen={() => {}} filtered />);
    expect(chart.queryByText("#дом")).toBeNull();
    expect(chart.getByRole("button", { name: /#работа.*900.*100%/ })).toBeInTheDocument();
    rerender(<ExpenseCharts expenses={[]} onOpen={() => {}} filtered />);
    expect(chart.getByText("Нет регулярных трат")).toBeInTheDocument();
    expect(chart.queryByRole("img")).toBeNull();
  });

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
