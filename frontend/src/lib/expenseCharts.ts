import type { Expense, ExpensePeriod } from "../types";

const MONTH_STEP = { month: 1, quarter: 3, year: 12 };
// Twelfths of a kopeck keep aggregation exact until the final rounding.
const MONTH_WEIGHT: Record<ExpensePeriod, number> = { day: 365, month: 12, quarter: 4, year: 1 };
const COLORS = ["#56b6c2", "#e8a03d", "#9d8cff", "#82bf91", "#e58c9d", "#719ee8", "#c0b36d", "#c89269"];

export function expenseColor(id: number): string {
  return COLORS[(id - 1) % COLORS.length];
}

export function daysInMonth(year: number, month: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month + 1, 0);
  return date.getUTCDate();
}

/** Project the current schedule, not payment history. Always clamp from the original anchor. */
export function paymentDays(expense: Expense, year: number, month: number): number[] {
  if (expense.status !== "recurring" || !expense.active || !expense.period || !expense.anchor_date) return [];
  const [anchorYear, anchorMonth, anchorDay] = expense.anchor_date.split("-").map(Number);
  const distance = (year - anchorYear) * 12 + month - (anchorMonth - 1);
  if (distance < 0) return [];
  const lastDay = daysInMonth(year, month);
  if (expense.period === "day") {
    const firstDay = distance === 0 ? anchorDay : 1;
    return Array.from({ length: lastDay - firstDay + 1 }, (_, index) => firstDay + index);
  }
  return distance % MONTH_STEP[expense.period] === 0 ? [Math.min(anchorDay, lastDay)] : [];
}

export function monthlyBreakdown(expenses: Expense[]): { items: { expense: Expense; amount: number }[]; total: number } {
  const weighted = expenses
    .filter((e) => e.status === "recurring" && e.active && e.period && e.amount > 0)
    .map((expense) => ({ expense, weight: expense.amount * MONTH_WEIGHT[expense.period!] }))
    .sort((a, b) => b.weight - a.weight || a.expense.id - b.expense.id);
  const numerator = weighted.reduce((sum, item) => sum + item.weight, 0);
  const whole = Math.floor(numerator / 12);
  const remainder = numerator % 12;
  const total = whole + (remainder > 6 || (remainder === 6 && whole % 2 === 1) ? 1 : 0);
  return { items: weighted.map(({ expense, weight }) => ({ expense, amount: weight / 12 })), total };
}
