import { useId, useMemo, useState, type CSSProperties } from "react";
import { expenseColor, monthlyBreakdown, tagBreakdown, tagColor } from "../lib/expenseCharts";
import { formatRub } from "../lib/money";
import type { Expense } from "../types";
import PaymentCalendar from "./PaymentCalendar";

const COLLAPSED_KEY = "tasktracker.expense-charts.collapsed";
const CIRCUMFERENCE = 2 * Math.PI * 82;

interface ChartItem {
  key: string;
  label: string;
  amount: number;
  color: string;
  expense?: Expense;
}

interface Props {
  expenses: Expense[];
  onOpen: (expense: Expense) => void;
  today?: Date;
  filtered?: boolean;
}

export default function ExpenseCharts({ expenses, onOpen, today = new Date(), filtered = false }: Props) {
  const panelId = useId();
  const [collapsed, setCollapsed] = useState(() => {
    try { return window.localStorage.getItem(COLLAPSED_KEY) === "true"; }
    catch { return false; }
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { window.localStorage.setItem(COLLAPSED_KEY, String(next)); }
    catch { /* The charts remain usable when storage is blocked. */ }
  };
  const monthly = useMemo(() => monthlyBreakdown(expenses), [expenses]);
  const total = monthly.total;
  const [mode, setMode] = useState<"expenses" | "tags">("expenses");
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const items: ChartItem[] = useMemo(() => mode === "tags"
    ? tagBreakdown(monthly.items).map(({ tag, amount }) => ({
      key: tag === null ? "untagged" : `tag:${tag}`, label: tag === null ? "Без тега" : `#${tag}`,
      amount, color: tagColor(tag),
    }))
    : monthly.items.map(({ expense, amount }) => ({
      key: `expense:${expense.id}`, label: expense.title, amount, color: expenseColor(expense.id), expense,
    })), [monthly, mode]);
  const selected = items.find((item) => item.key === highlighted);
  const unroundedTotal = items.reduce((sum, item) => sum + item.amount, 0);
  let offset = 0;

  return (
    <div className="min-w-0 shrink-0">
      <button type="button" className="mb-3 flex min-h-10 w-full items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-2 text-left text-sm text-dim hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        aria-expanded={!collapsed} aria-controls={panelId}
        aria-label={`${collapsed ? "Развернуть" : "Свернуть"}: Структура трат и календарь оплат`}
        onClick={toggleCollapsed}>
        <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>
        <span className="flex-1">Структура трат и календарь оплат</span>
        <span className="hidden text-xs sm:inline">{collapsed ? "Развернуть" : "Свернуть"}</span>
      </button>
      <div id={panelId} hidden={collapsed}>
      <div className="expense-charts">
      <section className="expense-breakdown" aria-labelledby="expense-breakdown-title">
        <div className="expense-chart-heading">
          <div>
            <h2 id="expense-breakdown-title">Структура трат</h2>
            <p>{filtered ? "Регулярные · по фильтрам доски" : "Регулярные · в среднем за месяц"}</p>
          </div>
          <span className="expense-chart-unit">₽ / мес.</span>
        </div>

        <div className="mx-5 mt-3 flex w-fit gap-1 rounded-lg border border-edge bg-night p-1" role="group" aria-label="Группировка структуры трат">
          {([["expenses", "По тратам"], ["tags", "По тегам"]] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={mode === value}
              className={`tab ${mode === value ? "bg-panel text-ink" : "text-dim hover:text-ink"}`}
              onClick={() => { setMode(value); setHighlighted(null); }}>{label}</button>
          ))}
        </div>
        {items.length > 0 ? (
          <div className="expense-breakdown-body">
            <div className="expense-donut">
              <svg viewBox="0 0 200 200" role="img" aria-label={`Регулярные траты${mode === "tags" ? " по тегам" : ""}: ${formatRub(total)} в среднем за месяц`}>
                <circle cx="100" cy="100" r="82" fill="none" stroke="var(--color-edge)" strokeWidth="20" />
                {items.map(({ key, color, amount }) => {
                  const length = amount / unroundedTotal * CIRCUMFERENCE;
                  const gap = items.length === 1 ? 0 : Math.min(4, length / 4);
                  const start = offset;
                  offset += length;
                  return (
                    <circle
                      key={key} cx="100" cy="100" r="82" fill="none"
                      stroke={color} strokeWidth={highlighted === key ? 25 : 20}
                      strokeDasharray={`${length - gap} ${CIRCUMFERENCE - length + gap}`}
                      strokeDashoffset={-start - gap / 2} transform="rotate(-90 100 100)"
                      opacity={selected && highlighted !== key ? 0.28 : 1}
                    />
                  );
                })}
              </svg>
              <div className="expense-donut-label" aria-hidden="true">
                <span>{selected ? selected.label : "В месяц"}</span>
                <strong>{formatRub(selected ? Math.round(selected.amount) : total)}</strong>
                <small>{selected ? `${(selected.amount / unroundedTotal * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% бюджета` : mode === "tags" ? `Категорий: ${items.length}` : `${items.length} регулярных трат`}</small>
              </div>
            </div>
            <ul className="expense-chart-legend" aria-label={mode === "tags" ? "Доли по тегам" : "Доли регулярных трат"}>
              {items.map(({ key, label, color, expense, amount }) => (
                <li key={key}>
                  <button
                    type="button" onClick={() => expense ? onOpen(expense) : setHighlighted(key)}
                    onMouseEnter={() => setHighlighted(key)} onMouseLeave={() => setHighlighted(null)}
                    onFocus={() => setHighlighted(key)} onBlur={() => setHighlighted(null)}
                    style={{ "--expense-color": color } as CSSProperties}
                  >
                    <span className="expense-color-dot" aria-hidden="true" />
                    <span className="expense-legend-name" title={label}>{label}</span>
                    <span className="expense-legend-value">{formatRub(Math.round(amount))}</span>
                    <span className="expense-legend-percent">{(amount / unroundedTotal * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}%</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="expense-chart-empty">
            <div className="expense-empty-ring" aria-hidden="true" />
            <strong>Нет регулярных трат</strong>
            <p>Добавьте трату с суммой больше нуля или измените фильтры.</p>
          </div>
        )}
        {mode === "tags" && <p className="expense-chart-note">Категории — это теги. Если у траты несколько тегов, сумма делится между ними поровну. Без тегов — «Без тега».</p>}
        <p className="expense-chart-note">Дневные, квартальные и годовые платежи приведены к месяцу. Траты на паузе не учитываются.</p>
      </section>
      <PaymentCalendar expenses={expenses} onOpen={onOpen} today={today} filtered={filtered} />
      </div>
      </div>
    </div>
  );
}
