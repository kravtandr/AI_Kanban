import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import ExpenseForm, { emptyExpenseForm, formToBody, type ExpenseFormValues } from "./ExpenseForm";

function Harness({ initial }: { initial: ExpenseFormValues }) {
  const [values, setValues] = useState(initial);
  return <ExpenseForm values={values} onChange={setValues} />;
}

describe("ExpenseForm", () => {
  it("период и дата списания видны только у регулярной", async () => {
    render(<Harness initial={emptyExpenseForm("wanted")} />);
    expect(screen.queryByLabelText("Период")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Регулярная" }));
    expect(screen.getByLabelText("Период")).toBeInTheDocument();
    expect(screen.getByLabelText("Дата списания")).toBeRequired();
    expect(screen.getByLabelText("Активна")).toBeChecked();
  });

  it("дата покупки видна только у купленной", async () => {
    render(<Harness initial={emptyExpenseForm("wanted")} />);
    expect(screen.queryByLabelText("Дата покупки")).toBeNull();
    await userEvent.click(screen.getByRole("radio", { name: "Куплено" }));
    expect(screen.getByLabelText("Дата покупки")).toBeInTheDocument();
  });

  it("не предлагает период «неделя»", async () => {
    render(<Harness initial={emptyExpenseForm("recurring")} />);
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Каждый день", "Каждый месяц", "Каждый квартал", "Каждый год"]);
  });
});

describe("formToBody", () => {
  it("рубли → копейки, у wanted период пуст", () => {
    const body = formToBody({ ...emptyExpenseForm("wanted"), title: "Монитор", amount: "35 000,50", tags: "Техника, дом" });
    expect(body).toEqual({
      title: "Монитор", amount: 3500050, status: "wanted", period: null, anchor_date: null,
      purchased_at: null, active: true, note: "", tags: ["техника", "дом"],
    });
  });
  it("у регулярной период и дата уходят", () => {
    const body = formToBody({ ...emptyExpenseForm("recurring"), title: "Зал", amount: "2500", period: "year", anchor_date: "2026-03-01" });
    expect(body.period).toBe("year");
    expect(body.anchor_date).toBe("2026-03-01");
  });
  // Обзор, находка #2: purchased_at/active раньше в тело не попадали вовсе —
  // «Дата покупки» и «Активна» были декоративными при создании.
  it("у купленной уходит выбранная дата покупки", () => {
    const body = formToBody({ ...emptyExpenseForm("bought"), title: "Наушники", amount: "500", purchased_at: "2026-01-15" });
    expect(body.status).toBe("bought");
    expect(body.purchased_at).toBe("2026-01-15");
  });
  it("у не-купленной purchased_at всегда null, что бы ни было в форме", () => {
    const body = formToBody({ ...emptyExpenseForm("wanted"), title: "x", amount: "1", purchased_at: "2026-01-15" });
    expect(body.purchased_at).toBeNull();
  });
  it("снятая галочка «активна» уходит в тело как false", () => {
    const body = formToBody({
      ...emptyExpenseForm("recurring"), title: "Зал", amount: "2500",
      anchor_date: "2026-03-01", active: false,
    });
    expect(body.active).toBe(false);
  });
  it("у не-регулярной active всегда true, что бы ни было в форме", () => {
    const body = formToBody({ ...emptyExpenseForm("recurring"), title: "x", amount: "1", active: false, status: "wanted" });
    expect(body.active).toBe(true);
  });
});
