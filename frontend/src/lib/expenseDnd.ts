import type { Expense, ExpenseStatus } from "../types";

/** Между колонками — только wanted ↔ bought (§10.2). Внутри своей — всегда. */
export function canDropTo(expense: Expense, target: ExpenseStatus): boolean {
  if (expense.status === target) return true;
  return expense.status !== "recurring" && target !== "recurring";
}

/** Разобрать id droppable-цели. */
export function parseDropTarget(
  overId: string | number | undefined,
): { status: ExpenseStatus; beforeId: number | null } | null {
  if (typeof overId !== "string") return null;
  const column = overId.match(/^(?:column|mobiledrop)-(recurring|wanted|bought)$/);
  if (column) return { status: column[1] as ExpenseStatus, beforeId: null };
  const card = overId.match(/^card-(recurring|wanted|bought)-(\d+)$/);
  if (card) return { status: card[1] as ExpenseStatus, beforeId: Number(card[2]) };
  return null;
}
