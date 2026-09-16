import { useMemo, useState, type CSSProperties } from "react";
import { expenseColor, monthlyBreakdown } from "../lib/expenseCharts";
import { formatRub } from "../lib/money";
import type { Expense } from "../types";
import PaymentCalendar from "./PaymentCalendar";

const CIRCUMFERENCE = 2 * Math.PI * 82;

function expenseStyle(id: number): CSSProperties {
  return { "--expense-color": expenseColor(id) } as CSSProperties;
}

interface Props {
  expenses: Expense[];
  onOpen: (expense: Expense) => void;
  today?: Date;
  filtered?: boolean;
}

export default function ExpenseCharts({ expenses, onOpen, today = new Date(), filtered = false }: Props) {
  const { items, total } = useMemo(() => monthlyBreakdown(expenses), [expenses]);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const selected = items.find((item) => item.expense.id === highlighted);
  const unroundedTotal = items.reduce((sum, item) => sum + item.amount, 0);
  let offset = 0;

  return (
    <div className="expense-charts">
      <section className="expense-breakdown" aria-labelledby="expense-breakdown-title">
        <div className="expense-chart-heading">
          <div>
            <h2 id="expense-breakdown-title">Структура трат</h2>
            <p>{filtered ? "Регулярные · по фильтрам доски" : "Регулярные · в среднем за месяц"}</p>
          </div>
          <span className="expense-chart-unit">₽ / мес.</span>
        </div>

        {items.length > 0 ? (
          <div className="expense-breakdown-body">
            <div className="expense-donut">
              <svg viewBox="0 0 200 200" role="img" aria-label={`Регулярные траты: ${formatRub(total)} в среднем за месяц`}>
                <circle cx="100" cy="100" r="82" fill="none" stroke="var(--color-edge)" strokeWidth="20" />
                {items.map(({ expense, amount }) => {
                  const length = amount / unroundedTotal * CIRCUMFERENCE;
                  const gap = items.length === 1 ? 0 : Math.min(4, length / 4);
                  const start = offset;
                  offset += length;
                  return (
                    <circle
                      key={expense.id} cx="100" cy="100" r="82" fill="none"
                      stroke={expenseColor(expense.id)} strokeWidth={highlighted === expense.id ? 25 : 20}
                      strokeDasharray={`${length - gap} ${CIRCUMFERENCE - length + gap}`}
                      strokeDashoffset={-start - gap / 2} transform="rotate(-90 100 100)"
                      opacity={selected && highlighted !== expense.id ? 0.28 : 1}
                    />
                  );
                })}
              </svg>
              <div className="expense-donut-label" aria-hidden="true">
                <span>{selected ? selected.expense.title : "В месяц"}</span>
                <strong>{formatRub(selected ? Math.round(selected.amount) : total)}</strong>
                <small>{selected ? `${(selected.amount / unroundedTotal * 100).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}% бюджета` : `${items.length} регулярных трат`}</small>
              </div>
            </div>
            <ul className="expense-chart-legend" aria-label="Доли регулярных трат">
              {items.map(({ expense, amount }) => (
                <li key={expense.id}>
                  <button
                    type="button" onClick={() => onOpen(expense)}
                    onMouseEnter={() => setHighlighted(expense.id)} onMouseLeave={() => setHighlighted(null)}
                    onFocus={() => setHighlighted(expense.id)} onBlur={() => setHighlighted(null)}
                    style={expenseStyle(expense.id)}
                  >
                    <span className="expense-color-dot" aria-hidden="true" />
                    <span className="expense-legend-name" title={expense.title}>{expense.title}</span>
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
        <p className="expense-chart-note">Дневные, квартальные и годовые платежи приведены к месяцу. Траты на паузе не учитываются.</p>
      </section>
      <PaymentCalendar expenses={expenses} onOpen={onOpen} today={today} filtered={filtered} />
    </div>
  );
}
