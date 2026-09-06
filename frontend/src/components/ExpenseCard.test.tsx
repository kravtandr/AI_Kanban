import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Expense } from "../types";
import { ExpenseCardView } from "./ExpenseCard";

const BASE: Expense = {
  id: 1,
  title: "Netflix",
  note: "",
  amount: 89900,
  status: "recurring",
  period: "month",
  anchor_date: "2026-01-15",
  active: true,
  purchased_at: null,
  tags: ["tv"],
  sort_order: 1,
  source: "ai",
  created_at: "2026-09-01T00:00:00",
  updated_at: "2026-09-01T00:00:00",
  next_charge: "2026-09-15",
};

const TODAY = new Date(2026, 8, 6);

describe("ExpenseCardView", () => {
  it("регулярная: сумма, период, следующее списание, тег, бейдж AI", () => {
    render(<ExpenseCardView expense={BASE} today={TODAY} />);
    // formatRub(89900) даёт "899\u00A0₽" (см. task-9-report.md), но screen.getByText
    // сверяет матчер БЕЗ нормализации против normalizer(textToMatch) — а тот схлопывает
    // \u00A0 в обычный \u0020 (collapseWhitespace: /\s+/g матчит и NBSP). Поэтому
    // здесь обычный пробел, а не экранированный NBSP.
    expect(screen.getByText("899\u0020₽")).toBeInTheDocument();
    expect(screen.getByText(/месяц · след\. 15 сент\./)).toBeInTheDocument();
    expect(screen.getByText("tv")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("подсвечивает списание сегодня и завтра", () => {
    const { rerender } = render(
      <ExpenseCardView expense={{ ...BASE, next_charge: "2026-09-06" }} today={TODAY} />,
    );
    expect(screen.getByTitle("Списание сегодня")).toHaveClass("text-amber");
    rerender(<ExpenseCardView expense={{ ...BASE, next_charge: "2026-09-07" }} today={TODAY} />);
    expect(screen.getByTitle("Списание завтра")).toHaveClass("text-amber");
  });

  it("ежедневная пишет «каждый день»", () => {
    render(
      <ExpenseCardView expense={{ ...BASE, period: "day", next_charge: "2026-09-06" }} today={TODAY} />,
    );
    expect(screen.getByText(/каждый день/)).toBeInTheDocument();
  });

  it("пауза: приглушена и без даты", () => {
    render(<ExpenseCardView expense={{ ...BASE, active: false, next_charge: null }} today={TODAY} />);
    expect(screen.getByText("пауза")).toBeInTheDocument();
    expect(screen.queryByText(/след\./)).toBeNull();
  });

  it("куплено: дата покупки", () => {
    render(
      <ExpenseCardView
        expense={{ ...BASE, status: "bought", period: null, anchor_date: null,
                   purchased_at: "2026-09-03", next_charge: null, source: "manual" }}
        today={TODAY}
      />,
    );
    expect(screen.getByText(/куплено 3 сент\./)).toBeInTheDocument();
    expect(screen.queryByText("AI")).toBeNull();
  });
});
