import { useMemo, useState, type CSSProperties } from "react";
import { daysInMonth, expenseColor, paymentDays } from "../lib/expenseCharts";
import { formatRub } from "../lib/money";
import { PERIODS, type Expense } from "../types";

interface Props {
  expenses: Expense[];
  onOpen: (expense: Expense) => void;
  today: Date;
  filtered: boolean;
}

export default function PaymentCalendar({ expenses, onOpen, today, filtered }: Props) {
  const [monthOffset, setMonthOffset] = useState(0);
  const monthDate = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const dayCount = daysInMonth(year, month);
  const days = Array.from({ length: dayCount }, (_, index) => index + 1);
  const rows = useMemo(() => expenses
    .map((expense) => ({ expense, days: paymentDays(expense, year, month) }))
    .filter((row) => row.days.length > 0)
    .sort((a, b) => a.days[0] - b.days[0] || a.expense.id - b.expense.id), [expenses, year, month]);
  const total = rows.reduce((sum, row) => sum + row.expense.amount * row.days.length, 0);
  const count = rows.reduce((sum, row) => sum + row.days.length, 0);
  const todayDay = monthOffset === 0 ? today.getDate() : null;
  const monthLabel = monthDate.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
  const gridStyle = { "--calendar-days": dayCount } as CSSProperties;

  return (
    <section className="payment-calendar" aria-labelledby="payment-calendar-title">
      <div className="expense-chart-heading">
        <div>
          <h2 id="payment-calendar-title">Календарь оплат</h2>
          <p>{filtered ? "План списаний · по фильтрам доски" : "План списаний по текущему расписанию"}</p>
        </div>
        <div className="payment-calendar-total"><strong>{formatRub(total)}</strong><span>за выбранный месяц</span></div>
      </div>
      <div className="payment-calendar-toolbar">
        <div className="payment-calendar-navigation">
          <button type="button" className="btn-icon" aria-label="Предыдущий месяц" onClick={() => setMonthOffset((v) => v - 1)}>‹</button>
          <span aria-live="polite">{monthLabel}</span>
          <button type="button" className="btn-icon" aria-label="Следующий месяц" onClick={() => setMonthOffset((v) => v + 1)}>›</button>
        </div>
        <button type="button" className="tab text-dim hover:text-ink" aria-label="Текущий месяц" onClick={() => setMonthOffset(0)}>Сегодня</button>
      </div>

      {rows.length > 0 ? (
        <div className="payment-calendar-scroll" role="region" aria-label="Расписание списаний по дням, прокручивается" tabIndex={0}>
          <div className="payment-calendar-grid" style={gridStyle}>
            <div className="payment-calendar-dates">
              <div className="payment-calendar-label">Трата / платёж</div>
              {days.map((day) => {
                const date = new Date(year, month, day);
                const weekend = date.getDay() === 0 || date.getDay() === 6;
                return (
                  <div key={day} className={`payment-calendar-date${weekend ? " is-weekend" : ""}${day === todayDay ? " is-today" : ""}`} aria-current={day === todayDay ? "date" : undefined}>
                    <span>{date.toLocaleDateString("ru-RU", { weekday: "short" })}</span><b>{day}</b>
                  </div>
                );
              })}
            </div>
            {rows.map(({ expense, days: chargeDays }) => (
              <div key={expense.id} className="payment-calendar-row" style={{ "--expense-color": expenseColor(expense.id) } as CSSProperties}>
                <button type="button" className="payment-calendar-label payment-calendar-expense" onClick={() => onOpen(expense)} title={expense.title}>
                  <span className="expense-color-dot" aria-hidden="true" />
                  <span><strong>{expense.title}</strong><small>{formatRub(expense.amount)} / {PERIODS.find((period) => period.id === expense.period)?.short}</small></span>
                </button>
                <div className="payment-calendar-track">
                  {days.map((day) => {
                    const weekday = new Date(year, month, day).getDay();
                    return <div key={day} style={{ gridColumn: day }} className={`payment-calendar-cell${weekday === 0 || weekday === 6 ? " is-weekend" : ""}${day === todayDay ? " is-today" : ""}`} />;
                  })}
                  <div className="payment-calendar-band" aria-hidden="true" style={{ gridColumn: `${chargeDays[0]} / ${chargeDays[chargeDays.length - 1] + 1}` }} />
                  {chargeDays.map((day) => {
                    const dateLabel = new Date(year, month, day).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" }).replace(/\s*г\.$/, "");
                    const label = `${expense.title} — ${dateLabel} — ${formatRub(expense.amount)}`;
                    return (
                      <button key={day} type="button" className="payment-calendar-charge" style={{ gridColumn: day }} aria-label={label} title={label} onClick={() => onOpen(expense)}>
                        <span aria-hidden="true">{day}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="payment-calendar-empty"><strong>В этом месяце списаний нет</strong><p>Выберите другой месяц или добавьте регулярную трату.</p></div>
      )}
      <div className="payment-calendar-footer">
        <span><i aria-hidden="true" /> Дата списания</span>
        <span>Списаний: {count}</span>
      </div>
      <p className="expense-chart-note">Это план, а не история оплат. Прошедшая дата не означает, что платёж выполнен.</p>
    </section>
  );
}
