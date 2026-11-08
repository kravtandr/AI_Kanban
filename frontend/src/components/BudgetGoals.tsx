import { formatRub } from "../lib/money";

const GROUPS = [
  {
    title: "На месяц",
    scale: 1,
    goals: [
      { label: "Отложить в этом месяце", factorTenths: 2, color: "bg-amber" },
      { label: "Бюджет на развлечения", factorTenths: 3, color: "bg-mcp" },
      { label: "Потолок постоянных трат", factorTenths: 5, color: "bg-ai" },
    ],
  },
  {
    title: "Долгосрочные цели",
    scale: 120,
    goals: [
      { label: "Финансовая подушка", factorTenths: 60, color: "bg-mcp" },
      { label: "Цель капитала", factorTenths: 1200, color: "bg-amber" },
    ],
  },
];

export default function BudgetGoals({ income }: { income: number | null }) {
  return (
    <section aria-labelledby="budget-goals" className="rounded-xl border border-edge bg-surface p-4 sm:p-6">
      <h3 id="budget-goals" className="text-lg font-medium">Цели от дохода</h3>
      {income === null ? (
        <p className="mt-2 text-sm text-dim">Заполните суммы, чтобы увидеть расчёт.</p>
      ) : (
        GROUPS.map(({ title, scale, goals }) => (
          <div key={title} role="group" aria-label={title} className="mt-6 border-t border-edge pt-4">
            <h4 className="text-sm font-medium">{title}</h4>
            <ul className="mt-4 space-y-4">
              {goals.map(({ label, factorTenths, color }) => {
                const amount = Math.round((income * factorTenths) / 10);
                return (
                  <li key={label}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                      <span>{label} <small className="ml-1 font-mono text-dim">×{(factorTenths / 10).toLocaleString("ru-RU")}</small></span>
                      <strong className="font-mono font-medium">{formatRub(amount)}</strong>
                    </div>
                    <div aria-hidden="true" className="mt-1.5 h-2 rounded-full bg-edge">
                      <div
                        className={`h-full rounded-full ${color}`}
                        style={{ width: `${income === 0 ? 0 : (amount / (income * scale)) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            <div aria-hidden="true" className="mt-2 flex justify-between gap-2 font-mono text-xs text-dim">
              <span>0 ₽</span>
              <span>Шкала до {formatRub(income * scale)}</span>
            </div>
          </div>
        ))
      )}
    </section>
  );
}
