import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../api";
import { fmtDur } from "../lib/duration";
import type { StuckTask, Task } from "../types";
import { STATUSES } from "../types";
import Modal from "./Modal";

interface Props {
  /** Задачи доски: «план на сегодня» — чистая клиентская арифметика по уже
   * загруженной выборке и таблице бакетов, без единого нового запроса. */
  tasks: Task[];
  /** Бюджет в часах живёт в URL доски (?budget=4), как остальное её
   * состояние, поэтому приходит пропом, а не хранится здесь. */
  budgetHours: number;
  onBudgetChange: (hours: number) => void;
  onClose: () => void;
}

/** Период ретро-блока. Окно режет ТОЛЬКО суммы «куда ушло время»:
 * калибровка, застрявшие и работающие считаются по всей истории (§7.4). */
const PERIODS = [7, 30, 90, 365];

const STATUS_TITLE = new Map<string, string>(STATUSES.map((s) => [s.id, s.title]));

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export default function StatsModal({ tasks, budgetHours, onBudgetChange, onClose }: Props) {
  const [days, setDays] = useState(30);
  const query = useQuery({ queryKey: ["analytics", days], queryFn: () => api.analytics(days) });
  // Единственное, что тратит токены. Мутация, а не запрос: при загрузке
  // страницы она не срабатывает никогда (NFR-6, §12.2 п.8).
  const insights = useMutation({ mutationFn: () => api.insights(days) });

  // insights.data переживает смену периода (мутация не завязана на days), а
  // блоки 1-7 уже пересчитались на новый период — без сброса абзац AI молча
  // продолжал бы описывать старое окно рядом с новыми числами.
  useEffect(() => {
    insights.reset();
    // insights — новый объект на каждый рендер (useMutation), а не стабильный
    // ref; в зависимостях он вызвал бы сброс на каждый чужой ре-рендер модалки
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days]);

  const data = query.data;
  const buckets = data?.buckets ?? [];
  const projects = data?.projects ?? [];
  const stuck = data?.stuck ?? [];
  const running = data?.running ?? [];
  const closed = data?.closed_minutes ?? 0;

  // Жадный набор в бюджет: задачи todo с оценкой, в порядке доски.
  const bucketMinutes = new Map(buckets.map((b) => [b.bucket, b.minutes]));
  const budgetMinutes = Math.round(budgetHours * 60);
  const plan: { task: Task; minutes: number }[] = [];
  let planned = 0;
  for (const task of tasks) {
    if (task.status !== "todo" || !task.estimate) continue;
    const minutes = bucketMinutes.get(task.estimate);
    if (!minutes || planned + minutes > budgetMinutes) continue;
    plan.push({ task, minutes });
    planned += minutes;
  }

  // Группировка застрявших по статусу — на клиенте (§12.2 п.5).
  const stuckByStatus = new Map<string, StuckTask[]>();
  for (const item of stuck) {
    const list = stuckByStatus.get(item.status) ?? [];
    list.push(item);
    stuckByStatus.set(item.status, list);
  }

  return (
    <Modal onClose={onClose} title="Время">
      <div aria-live="polite">
        {query.isError && (
          <p className="mb-3 text-sm text-danger">
            Не удалось загрузить статистику — закройте и откройте окно ещё раз
          </p>
        )}
      </div>

      {/* 1. Баннер холодного старта. Условие — именно untracked_tasks:
        на боевой доске в день запуска это 3, а не 39, и завышать ущерб на
        порядок баннер не имеет права. */}
      {data && data.coverage.untracked_tasks > 0 && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-amber/40 bg-amber/10 p-3 text-sm"
        >
          <p>
            <b className="font-mono">{data.coverage.untracked_tasks}</b> задач не попадут в
            калибровку: замеры включились, когда они уже были в работе
          </p>
          {data.coverage.seeded_tasks > data.coverage.untracked_tasks && (
            <p className="mt-1 font-mono text-[11px] text-dim">
              ещё {data.coverage.seeded_tasks - data.coverage.untracked_tasks} задач существовали
              до замеров, но правило допуска их не отсекает
            </p>
          )}
          {data.coverage.drift_repaired > 0 && (
            <p className="mt-1 font-mono text-[11px] text-dim">
              у {data.coverage.drift_repaired} задач состояние разошлось с журналом и было
              зачинено сверкой — это третий случай, с двумя числами выше не складывается
            </p>
          )}
        </div>
      )}

      {/* 2. Калибровка. Подписи периода здесь НЕТ намеренно: калибровка
        считается по всей истории и окном не ограничена (§7.4). */}
      <section aria-label="Калибровка" className="mb-5">
        <h3 className="eyebrow">Калибровка · по всей истории</h3>
        <table className="w-full font-mono text-xs">
          <tbody>
            {buckets.length === 0 && (
              <tr>
                <td className="py-1 text-dim">—</td>
              </tr>
            )}
            {buckets.map((b) => (
              <tr key={b.bucket} className="border-b border-edge/40 last:border-0">
                <td className="py-1 pr-2 font-medium">{b.bucket}</td>
                <td className="py-1 pr-2 text-dim">шкала {b.seed_minutes}м</td>
                <td className="py-1 pr-2">
                  {b.calibrated ? (
                    <span>по факту {b.minutes}м</span>
                  ) : (
                    <span className="text-dim">— мало данных (n={b.samples})</span>
                  )}
                </td>
                <td className="py-1 text-right text-dim">{b.calibrated ? `n=${b.samples}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.inversions.length > 0 && (
          <p className="mt-1 font-mono text-[11px] text-dim">
            шкала не монотонна ({data.inversions.join(", ")}): данных пока мало
          </p>
        )}
      </section>

      {/* 3 и 4. Куда ушло время и смещение по проектам. Знаменатель
        процентов — closed_minutes доски; инвариант sum(p.closed_minutes) ==
        closed_minutes держит сумму в 100% (§8.4). */}
      <section aria-label="Куда ушло время" className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">Куда ушло время</h3>
          <label className="mb-1 flex items-center gap-1 font-mono text-[11px] text-dim">
            <span>период</span>
            <select
              aria-label="Период"
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="rounded-md border border-edge bg-night px-1.5 py-0.5 text-ink"
            >
              {PERIODS.map((d) => (
                <option key={d} value={d}>
                  {d} дней
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="mb-2 font-mono text-[11px] text-dim">
          за {days} дней · только закрытые заходы
        </p>
        {projects.length === 0 && <p className="font-mono text-xs text-dim">—</p>}
        {projects.map((p) => (
          <div key={p.project_id} className="mb-2">
            <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
              <span className="truncate" style={{ color: p.color }}>
                {p.project}
              </span>
              <span className="shrink-0 text-dim">
                {fmtDur(p.closed_minutes * 60)} · {pct(p.closed_minutes, closed)}%
              </span>
            </div>
            <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-edge/40">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct(p.closed_minutes, closed)}%`,
                  backgroundColor: p.color,
                }}
              />
            </div>
            {p.open_minutes > 0 && (
              <>
                {/* Открытое время — штриховкой и подписью «ещё идёт»;
                  с закрытым не складывается ни в одно число (R8). */}
                <div
                  className="mt-0.5 h-1 rounded-full"
                  style={{
                    width: `${Math.min(100, pct(p.open_minutes, closed))}%`,
                    backgroundImage: `repeating-linear-gradient(45deg, ${p.color} 0 3px, transparent 3px 6px)`,
                  }}
                />
                <p className="font-mono text-[10px] text-dim">
                  ещё идёт: {fmtDur(p.open_minutes * 60)}
                </p>
              </>
            )}
            {p.factor !== null && (
              <p className="mt-0.5 font-mono text-[10px] text-dim">
                ×{p.factor.toFixed(1)}
                {data?.board_factor ? ` · по доске ×${data.board_factor.toFixed(1)}` : ""}
                {p.relative !== null ? ` · относительно ×${p.relative.toFixed(1)}` : ""}
                {` (n=${p.samples})`}
              </p>
            )}
          </div>
        ))}
        {data && data.deleted_minutes > 0 && (
          <p className="mt-2 font-mono text-[11px] text-dim">
            по удалённым задачам: {fmtDur(data.deleted_minutes * 60)} — вне стопки процентов
          </p>
        )}
      </section>

      {/* 5. Где застревает. days — длительность ТЕКУЩЕЙ резиденции, окном
        не ограничена, поэтому «до 23 дней» достижимо и при days=7. */}
      <section aria-label="Где застревает" className="mb-5">
        <h3 className="eyebrow">Где застревает</h3>
        {stuck.length === 0 && <p className="font-mono text-xs text-dim">—</p>}
        {[...stuckByStatus.entries()].map(([status, items]) => (
          <div key={status} className="mb-2">
            <p className="font-mono text-[11px] text-dim">
              {STATUS_TITLE.get(status) ?? status} · {items.length} задач, до{" "}
              {Math.round(Math.max(...items.map((i) => i.days)))} дней
            </p>
            <ul className="mt-0.5 flex flex-col gap-0.5">
              {items.map((i) => (
                <li key={i.task_id} className="font-mono text-[11px]">
                  <span className="text-dim">#{i.task_id}</span> {i.title}{" "}
                  <span className="text-dim">
                    · {Math.round(i.days)} дней · {i.spells} заходов
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {/* 6. Сейчас в работе. open_seconds и closed_seconds — два числа,
        которые не складываются нигде (R8). */}
      <section aria-label="Сейчас в работе" className="mb-5">
        <h3 className="eyebrow">Сейчас в работе</h3>
        {running.length === 0 && <p className="font-mono text-xs text-dim">—</p>}
        <ul className="flex flex-col gap-0.5">
          {running.map((r) => (
            <li key={r.task_id} className="font-mono text-[11px]">
              <span className="text-dim">#{r.task_id}</span> {r.title}{" "}
              <span className={r.over !== null && r.over > 1 ? "text-danger" : "text-amber"}>
                <span aria-hidden="true">▶</span> {fmtDur(r.open_seconds)}
              </span>
              {r.predicted_minutes !== null && (
                <span className="text-dim">
                  {" "}
                  (оценка {fmtDur(r.predicted_minutes * 60)}
                  {r.over !== null ? `, ×${r.over.toFixed(1)}` : ""})
                </span>
              )}
              {r.closed_seconds > 0 && (
                <span className="text-dim"> (+{fmtDur(r.closed_seconds)} ранее)</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {/* 7. План на сегодня — арифметика по уже загруженным данным. */}
      <section aria-label="План на сегодня" className="mb-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">План на сегодня</h3>
          <label className="mb-1 flex items-center gap-1 font-mono text-[11px] text-dim">
            <span>бюджет, ч</span>
            <input
              type="number"
              min={1}
              max={16}
              step={1}
              aria-label="Бюджет в часах"
              value={budgetHours}
              onChange={(e) => onBudgetChange(Number(e.target.value) || 1)}
              className="w-14 rounded-md border border-edge bg-night px-1.5 py-0.5 text-ink"
            />
          </label>
        </div>
        {plan.length === 0 && <p className="font-mono text-xs text-dim">—</p>}
        <ul className="flex flex-col gap-0.5">
          {plan.map(({ task, minutes }) => (
            <li key={task.id} className="font-mono text-[11px]">
              <span className="text-dim">{task.estimate}</span> {task.title}{" "}
              <span className="text-dim">· {fmtDur(minutes * 60)}</span>
            </li>
          ))}
        </ul>
        {plan.length > 0 && (
          <p className="mt-1 font-mono text-[11px] text-dim">
            набрано {fmtDur(planned * 60)} из {budgetHours}ч
          </p>
        )}
      </section>

      {/* 8. Единственный вызов LLM во всей странице — и только по клику. */}
      <section aria-label="Объяснение AI">
        <button onClick={() => insights.mutate()} disabled={insights.isPending} className="btn-ai">
          <span aria-hidden="true">✨</span> {insights.isPending ? "Думаю…" : "объяснить"}
        </button>
        <div aria-live="polite">
          {insights.isError && (
            <p className="mt-2 text-sm text-danger">
              Не удалось запросить AI — числа выше от него не зависят
            </p>
          )}
          {insights.data?.ai_ok && <p className="mt-2 text-sm text-ai">{insights.data.text}</p>}
          {insights.data && !insights.data.ai_ok && (
            <p className="mt-2 font-mono text-[11px] text-dim">
              AI недоступен: {insights.data.ai_error ?? "нет ответа"} — числа выше не зависят от
              него
            </p>
          )}
        </div>
        {insights.data && (
          <details className="mt-2">
            <summary className="cursor-pointer font-mono text-[11px] text-dim">
              Факты, которые видел AI
            </summary>
            {/* Выдуманное число видно тем, что его нет в фактах (§11.3). */}
            <pre className="mt-1 overflow-x-auto rounded-lg border border-edge bg-night p-2 font-mono text-[10px] whitespace-pre-wrap text-dim">
              {insights.data.facts}
            </pre>
          </details>
        )}
      </section>

      {/* as_of — ПОДПИСЬ, и только подпись. Режем строку, а не разбираем
        её new Date(...): наивный UTC разобрался бы как локальное время
        и соврал бы на величину смещения пояса (§10.1). */}
      {data && (
        <p className="mt-4 font-mono text-[10px] text-dim/70">
          данные на {data.coverage.as_of.replace("T", " ").slice(0, 16)} UTC
        </p>
      )}
    </Modal>
  );
}
