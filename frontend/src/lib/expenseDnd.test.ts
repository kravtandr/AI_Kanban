import { describe, expect, it } from "vitest";
import type { Expense } from "../types";
import { canDropTo, parseDropTarget } from "./expenseDnd";

const base = { id: 1, title: "", note: "", amount: 0, period: null, anchor_date: null,
  active: true, purchased_at: null, tags: [], sort_order: 0, source: "manual",
  created_at: "", updated_at: "", next_charge: null };

describe("canDropTo", () => {
  it("wanted ↔ bought разрешено, recurring — только в свою колонку", () => {
    const wanted = { ...base, status: "wanted" } as Expense;
    const rec = { ...base, status: "recurring" } as Expense;
    expect(canDropTo(wanted, "bought")).toBe(true);
    expect(canDropTo(wanted, "recurring")).toBe(false);
    expect(canDropTo(rec, "wanted")).toBe(false);
    expect(canDropTo(rec, "recurring")).toBe(true);
  });
});

describe("parseDropTarget", () => {
  it("колонка, мобильный таб, карточка, мусор", () => {
    expect(parseDropTarget("column-wanted")).toEqual({ status: "wanted", beforeId: null });
    expect(parseDropTarget("mobiledrop-bought")).toEqual({ status: "bought", beforeId: null });
    expect(parseDropTarget("card-recurring-7")).toEqual({ status: "recurring", beforeId: 7 });
    expect(parseDropTarget("expense-7")).toBeNull();
    expect(parseDropTarget(undefined)).toBeNull();
  });
});
