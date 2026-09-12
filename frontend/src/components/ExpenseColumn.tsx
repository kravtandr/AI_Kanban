import { useDroppable } from "@dnd-kit/core";
import type { MutableRefObject } from "react";
import { formatRub } from "../lib/money";
import type { Expense, ExpenseStatus } from "../types";
import ExpenseCard from "./ExpenseCard";

interface Props {
  id: ExpenseStatus;
  title: string;
  expenses: Expense[];
  onOpen: (expense: Expense) => void;
  onAdd: (status: ExpenseStatus) => void;
  activeOnMobile: boolean;
  /** Может ли тащимая карточка сюда упасть; false гасит подсветку (§10.2). */
  canDrop: boolean;
  clickGuard: MutableRefObject<boolean>;
}

/** Droppable-обёртка карточки: сброс «на карточку» значит «перед ней» —
 * id несёт статус и id цели, чтобы onDragEnd мог поставить sort_order. */
function CardSlot({ expense, onOpen, clickGuard, canDrop }: {
  expense: Expense; onOpen: (e: Expense) => void; clickGuard: MutableRefObject<boolean>; canDrop: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `card-${expense.status}-${expense.id}`,
    disabled: !canDrop,
  });
  return (
    <div ref={setNodeRef} className={isOver && canDrop ? "border-t-2 border-amber pt-1" : ""}>
      <ExpenseCard expense={expense} onOpen={onOpen} clickGuard={clickGuard} />
    </div>
  );
}

export default function ExpenseColumn({
  id, title, expenses, onOpen, onAdd, activeOnMobile, canDrop, clickGuard,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${id}`, disabled: !canDrop });
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <section
      ref={setNodeRef}
      className={`${activeOnMobile ? "flex" : "hidden"} min-w-0 flex-1 flex-col rounded-xl transition-colors md:flex md:border md:p-1.5 ${
        isOver && canDrop ? "bg-amber/5 md:border-amber/60" : "md:border-edge/60 md:bg-panel/40"
      }`}
    >
      <header className="hidden items-baseline gap-2 px-2 pt-1 pb-2 md:flex">
        <h2 className="font-mono text-[11px] font-medium tracking-[0.16em] text-dim uppercase">
          {title}
        </h2>
        <span className="font-mono text-[11px] text-dim/60">{expenses.length}</span>
        <span className="font-mono text-[11px] text-dim/60">{formatRub(total)}</span>
        <button
          onClick={() => onAdd(id)}
          aria-label={`Добавить трату в ${title}`}
          title={`Добавить трату в ${title}`}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md font-mono text-sm text-dim/70 transition hover:bg-edge/50 hover:text-amber"
        >
          +
        </button>
      </header>
      <div className="card-list flex flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-0.5 pb-28 md:pb-2">
        {expenses.map((e) => (
          <CardSlot key={e.id} expense={e} onOpen={onOpen} clickGuard={clickGuard} canDrop={canDrop} />
        ))}
        {expenses.length === 0 && (
          <button
            onClick={() => onAdd(id)}
            className="rounded-lg p-6 text-center font-mono text-xs text-dim/50 transition hover:text-dim"
          >
            пусто — добавить
          </button>
        )}
      </div>
    </section>
  );
}
