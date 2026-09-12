import { useState } from "react";
import { formatDue } from "../lib/dates";
import { formatRub } from "../lib/money";
import type { ExpenseSummary } from "../types";

interface Props {
  summary: ExpenseSummary;
}

const MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** Полоса итогов под шапкой (§10.3): четыре моно-числа, «ближайшие» раскрываются. */
export default function ExpenseSummaryBar({ summary }: Props) {
  const [open, setOpen] = useState(false);
  const month = MONTHS[new Date().getMonth()];
  return (
    <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs text-dim md:flex md:flex-wrap md:gap-x-6">
      <span>
        в месяц <b className="text-ink">{formatRub(summary.monthly_recurring)}</b>
      </span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-left hover:text-ink"
      >
        ближайшие 7 дней <b className="text-ink">{formatRub(summary.upcoming_total)}</b>
        {summary.upcoming.length > 0 && ` (${summary.upcoming.length})`}
      </button>
      <span>
        хочу <b className="text-ink">{formatRub(summary.wanted_total)}</b>
      </span>
      <span>
        куплено в {month} <b className="text-ink">{formatRub(summary.bought_this_month)}</b>
      </span>
      {open && (
        <ul className="col-span-2 mt-1 flex w-full flex-col gap-0.5 rounded-lg border border-edge/60 bg-panel/40 p-2">
          {summary.upcoming.length === 0 && <li className="text-dim/60">ничего не списывается</li>}
          {summary.upcoming.map((u) => (
            <li key={`${u.expense_id}-${u.date}`} className="flex justify-between gap-3">
              <span>
                {formatDue(u.date)} · <span>{u.title}</span>
              </span>
              <span className="text-ink">{formatRub(u.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
