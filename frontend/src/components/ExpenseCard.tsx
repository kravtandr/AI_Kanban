import { useDraggable } from "@dnd-kit/core";
import type { MutableRefObject } from "react";
import { formatDue } from "../lib/dates";
import { formatRub } from "../lib/money";
import { PERIODS, type Expense } from "../types";

interface ViewProps {
  expense: Expense;
  overlay?: boolean;
  /** Точка отсчёта для «сегодня/завтра»; проп ради тестов. */
  today?: Date;
}

function daysUntil(iso: string, today: Date): number {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

const SOURCE_BADGE: Record<Expense["source"], { label: string; cls: string } | null> = {
  manual: null,
  ai: { label: "AI", cls: "text-ai" },
  mcp: { label: "MCP", cls: "text-mcp" },
};

/** Чистая разметка карточки: используется и на доске, и в DragOverlay. */
export function ExpenseCardView({ expense, overlay = false, today = new Date() }: ViewProps) {
  const period = PERIODS.find((p) => p.id === expense.period);
  const badge = SOURCE_BADGE[expense.source];
  const paused = expense.status === "recurring" && !expense.active;

  let schedule: { text: string; cls: string; title: string } | null = null;
  if (expense.status === "recurring" && expense.active && expense.next_charge && period) {
    const days = daysUntil(expense.next_charge, today);
    const soon = days === 0 ? "сегодня" : days === 1 ? "завтра" : null;
    schedule = {
      text:
        period.id === "day"
          ? "каждый день"
          : `${period.short} · след. ${formatDue(expense.next_charge)}`,
      cls: soon ? "font-medium text-amber" : "",
      title: soon ? `Списание ${soon}` : "Следующее списание",
    };
  }

  return (
    <div
      className={`rounded-lg border bg-card px-3 py-2.5 ${paused ? "opacity-50" : ""} ${
        overlay
          ? "rotate-1 border-edge shadow-2xl ring-2 ring-amber/50"
          : "border-edge/60 transition hover:border-dim/40"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-[15px] leading-snug font-medium break-words md:text-sm">
          {expense.title}
        </p>
        <span className="shrink-0 font-mono text-sm text-ink">{formatRub(expense.amount)}</span>
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-dim">
        {paused && <span title="На паузе">пауза</span>}
        {schedule && (
          <span className={schedule.cls} title={schedule.title}>
            {schedule.text}
          </span>
        )}
        {expense.status === "bought" && expense.purchased_at && (
          <span title="Дата покупки">куплено {formatDue(expense.purchased_at)}</span>
        )}
        {expense.tags.map((tag) => (
          <span key={tag} className="rounded-md bg-edge/40 px-1.5 py-px">
            {tag}
          </span>
        ))}
        {badge && <span className={badge.cls}>{badge.label}</span>}
      </p>
    </div>
  );
}

interface Props {
  expense: Expense;
  onOpen: (expense: Expense) => void;
  /** Пока true — click игнорируется: после drag браузер шлёт «сквозной» click. */
  clickGuard: MutableRefObject<boolean>;
}

export default function ExpenseCard({ expense, onOpen, clickGuard }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `expense-${expense.id}`,
    data: { expense },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (!clickGuard.current) onOpen(expense);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(expense);
        }
      }}
      className={`cursor-grab touch-manipulation select-none ${isDragging ? "opacity-30" : ""}`}
    >
      <ExpenseCardView expense={expense} />
    </div>
  );
}
