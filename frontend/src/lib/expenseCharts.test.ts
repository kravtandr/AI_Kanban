import { describe, expect, it } from "vitest";
import type { Expense } from "../types";
import { monthlyBreakdown, paymentDays, tagBreakdown } from "./expenseCharts";

const expense = (fields: Partial<Expense> = {}): Expense => ({
  id: 1, title: "Подписка", note: "", amount: 12000, status: "recurring",
  period: "month", anchor_date: "2024-01-31", active: true, purchased_at: null,
  tags: [], sort_order: 0, source: "manual", created_at: "2024-01-01T00:00:00",
  updated_at: "2024-01-01T00:00:00", next_charge: null, ...fields,
});

describe("paymentDays", () => {
  it.each([
    ["2024-01-31", "month", 2024, 1, [29]],
    ["2024-01-31", "month", 2024, 2, [31]],
    ["2024-01-31", "month", 2025, 1, [28]],
    ["2024-02-29", "year", 2025, 1, [28]],
    ["2024-02-29", "year", 2028, 1, [29]],
    ["2024-01-31", "quarter", 2024, 3, [30]],
    ["2024-01-31", "quarter", 2024, 4, []],
    ["2024-12-31", "month", 2025, 0, [31]],
    ["2026-10-01", "month", 2026, 8, []],
    ["2026-09-28", "day", 2026, 8, [28, 29, 30]],
    ["2026-10-01", "day", 2026, 8, []],
  ] as const)("%s %s → %i/%i", (anchor_date, period, year, month, expected) => {
    expect(paymentDays(expense({ anchor_date, period }), year, month)).toEqual(expected);
  });

  it("includes every day in a leap February for an existing daily expense", () => {
    const days = paymentDays(expense({ period: "day" }), 2024, 1);
    expect(days).toHaveLength(29);
    expect(days[0]).toBe(1);
    expect(days[28]).toBe(29);
  });

  it("excludes paused, wanted and incomplete expenses but keeps free scheduled payments", () => {
    for (const fields of [{ active: false }, { status: "wanted" as const }, { anchor_date: null }, { period: null }]) {
      expect(paymentDays(expense(fields), 2026, 8)).toEqual([]);
    }
    expect(paymentDays(expense({ amount: 0 }), 2026, 8)).toEqual([30]);
  });
});

describe("monthlyBreakdown", () => {
  it("normalizes periods and excludes paused and non-recurring expenses", () => {
    const result = monthlyBreakdown([
      expense({ id: 1, period: "day", amount: 1200 }),
      expense({ id: 2 }),
      expense({ id: 3, period: "quarter" }),
      expense({ id: 4, period: "year" }),
      expense({ id: 5, active: false }),
      expense({ id: 6, status: "bought" }),
      expense({ id: 7, status: "wanted" }),
      expense({ id: 8, amount: 0 }),
    ]);
    expect(result.total).toBe(53500);
    expect(result.items.map((item) => [item.expense.id, item.amount])).toEqual([
      [1, 36500], [2, 12000], [3, 4000], [4, 1000],
    ]);
  });

  it("rounds only after summing and uses half-even rounding like the summary", () => {
    expect(monthlyBreakdown([expense({ period: "year", amount: 6 })]).total).toBe(0);
    expect(monthlyBreakdown([expense({ period: "year", amount: 18 })]).total).toBe(2);
    expect(monthlyBreakdown([
      expense({ period: "year", amount: 6 }), expense({ id: 2, period: "year", amount: 6 }),
    ]).total).toBe(1);
  });

  it("returns an empty breakdown without invalid proportions", () => {
    expect(monthlyBreakdown([])).toEqual({ items: [], total: 0 });
  });
});


describe("tagBreakdown", () => {
  it("splits the normalized monthly cost across unique tags", () => {
    const monthly = monthlyBreakdown([
      expense({ tags: [" Дом ", "дом", "связь"], period: "year" }),
      expense({ id: 2, tags: ["дом"], period: "quarter" }),
      expense({ id: 3, tags: [], amount: 6000 }),
    ]);
    const groups = tagBreakdown(monthly.items);
    expect(groups).toEqual([
      { tag: null, amount: 6000 }, { tag: "дом", amount: 4500 }, { tag: "связь", amount: 500 },
    ]);
    expect(groups.reduce((sum, group) => sum + group.amount, 0)).toBe(monthly.total);
  });

  it("keeps the actual tag Без тега separate from untagged expenses", () => {
    expect(tagBreakdown(monthlyBreakdown([
      expense({ tags: ["без тега"] }), expense({ id: 2, tags: [" "] }),
    ]).items)).toEqual([{ tag: null, amount: 12000 }, { tag: "без тега", amount: 12000 }]);
  });

  it("handles three-way fractional shares without rounding each expense prematurely", () => {
    const groups = tagBreakdown(monthlyBreakdown([expense({ amount: 100, tags: ["a", "b", "c"] })]).items);
    expect(groups).toHaveLength(3);
    expect(groups[0].amount).toBeCloseTo(33.3333333333);
    expect(groups.reduce((sum, group) => sum + group.amount, 0)).toBeCloseTo(100);
    expect(tagBreakdown([])).toEqual([]);
  });
});
