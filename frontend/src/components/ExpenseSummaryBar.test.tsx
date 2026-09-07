import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ExpenseSummaryBar from "./ExpenseSummaryBar";

describe("ExpenseSummaryBar", () => {
  it("показывает четыре итога и раскрывает ближайшие", async () => {
    render(
      <ExpenseSummaryBar
        summary={{
          monthly_recurring: 1234000,
          upcoming: [{ expense_id: 1, title: "Netflix", amount: 89900, date: "2026-09-15" }],
          upcoming_total: 89900,
          wanted_total: 4500000,
          bought_this_month: 890000,
          currency: "RUB",
        }}
      />,
    );
    expect(screen.getByText("12 340 ₽")).toBeInTheDocument();
    expect(screen.getByText("45 000 ₽")).toBeInTheDocument();
    expect(screen.getByText("8 900 ₽")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /ближайшие 7 дней/ }));
    expect(screen.getByText("Netflix")).toBeInTheDocument();
  });
});
