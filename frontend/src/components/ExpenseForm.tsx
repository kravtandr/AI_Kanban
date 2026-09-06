import { useId, type Ref } from "react";
import { parseRub } from "../lib/money";
import type { ExpensePeriod, ExpenseStatus } from "../types";
import { EXPENSE_COLUMNS, PERIODS } from "../types";
import { parseTags } from "./TaskForm";

export interface ExpenseFormValues {
  title: string;
  /** Рубли, как ввёл пользователь; в копейки переводит formToBody. */
  amount: string;
  status: ExpenseStatus;
  period: ExpensePeriod;
  anchor_date: string;
  purchased_at: string;
  note: string;
  tags: string;
  active: boolean;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function emptyExpenseForm(status: ExpenseStatus): ExpenseFormValues {
  return {
    title: "",
    amount: "",
    status,
    period: "month",
    anchor_date: status === "recurring" ? todayIso() : "",
    purchased_at: status === "bought" ? todayIso() : "",
    note: "",
    tags: "",
    active: true,
  };
}

export interface ExpenseBody {
  title: string;
  amount: number;
  status: ExpenseStatus;
  period: ExpensePeriod | null;
  anchor_date: string | null;
  note: string;
  tags: string[];
}

/** Тело POST /expenses. Инвариант §4 выполняется здесь же: у не-регулярной
 * период и дата обнуляются, что бы ни осталось в форме от прошлого типа. */
export function formToBody(v: ExpenseFormValues): ExpenseBody {
  const recurring = v.status === "recurring";
  return {
    title: v.title.trim(),
    amount: parseRub(v.amount) ?? 0,
    status: v.status,
    period: recurring ? v.period : null,
    anchor_date: recurring ? v.anchor_date || null : null,
    note: v.note,
    tags: parseTags(v.tags),
  };
}

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  recurring: "Регулярная",
  wanted: "Хочу купить",
  bought: "Куплено",
};

interface Props {
  values: ExpenseFormValues;
  onChange: (values: ExpenseFormValues) => void;
  titleError?: string | null;
  amountError?: string | null;
  /** Общий слот ошибки для «Дата списания»/«Дата покупки» — поля взаимно
   * исключающие (статус один), поэтому на экране всегда виден максимум один
   * из них и id не задваивается. */
  dateError?: string | null;
  titleRef?: Ref<HTMLInputElement>;
  amountRef?: Ref<HTMLInputElement>;
  anchorDateRef?: Ref<HTMLInputElement>;
  purchasedAtRef?: Ref<HTMLInputElement>;
}

export default function ExpenseForm({
  values, onChange, titleError = null, amountError = null, dateError = null,
  titleRef, amountRef, anchorDateRef, purchasedAtRef,
}: Props) {
  const set = (patch: Partial<ExpenseFormValues>) => onChange({ ...values, ...patch });
  const titleErrId = useId();
  const amountErrId = useId();
  const dateErrId = useId();
  const group = useId();
  const recurring = values.status === "recurring";

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block">
          <span className="eyebrow">Название</span>
          <input
            ref={titleRef}
            name="title"
            autoComplete="off"
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
            maxLength={200}
            required
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? titleErrId : undefined}
            className="input"
          />
        </label>
        {titleError && <span id={titleErrId} className="field-error">{titleError}</span>}
      </div>
      <div>
        <label className="block">
          <span className="eyebrow">Сумма, ₽</span>
          <input
            ref={amountRef}
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            value={values.amount}
            onChange={(e) => set({ amount: e.target.value })}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? amountErrId : undefined}
            className="input font-mono"
          />
        </label>
        {amountError && <span id={amountErrId} className="field-error">{amountError}</span>}
      </div>
      <fieldset>
        <legend className="eyebrow">Тип</legend>
        <div className="flex gap-1">
          {EXPENSE_COLUMNS.map((col) => (
            <label key={col.id} className={`tab cursor-pointer ${values.status === col.id ? "bg-panel text-ink" : "text-dim"}`}>
              <input
                type="radio"
                name={`status-${group}`}
                value={col.id}
                checked={values.status === col.id}
                onChange={() =>
                  set({
                    status: col.id,
                    anchor_date: col.id === "recurring" ? values.anchor_date || todayIso() : values.anchor_date,
                    purchased_at: col.id === "bought" ? values.purchased_at || todayIso() : values.purchased_at,
                  })
                }
                className="sr-only"
              />
              {STATUS_LABEL[col.id]}
            </label>
          ))}
        </div>
      </fieldset>
      {recurring && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="eyebrow">Период</span>
            <select
              aria-label="Период"
              value={values.period}
              onChange={(e) => set({ period: e.target.value as ExpensePeriod })}
              className="input"
            >
              {PERIODS.map((p) => (
                <option key={p.id} value={p.id}>{p.title}</option>
              ))}
            </select>
          </label>
          <div>
            <label className="block">
              <span className="eyebrow">Дата списания</span>
              <input
                ref={anchorDateRef}
                type="date"
                aria-label="Дата списания"
                required
                value={values.anchor_date}
                onChange={(e) => set({ anchor_date: e.target.value })}
                aria-invalid={dateError ? true : undefined}
                aria-describedby={dateError ? dateErrId : undefined}
                className="input"
              />
            </label>
            {dateError && <span id={dateErrId} className="field-error">{dateError}</span>}
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              aria-label="Активна"
              checked={values.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            Активна (снять — поставить на паузу, из итогов уйдёт)
          </label>
        </div>
      )}
      {values.status === "bought" && (
        <div>
          <label className="block">
            <span className="eyebrow">Дата покупки</span>
            <input
              ref={purchasedAtRef}
              type="date"
              aria-label="Дата покупки"
              value={values.purchased_at}
              onChange={(e) => set({ purchased_at: e.target.value })}
              aria-invalid={dateError ? true : undefined}
              aria-describedby={dateError ? dateErrId : undefined}
              className="input"
            />
          </label>
          {dateError && <span id={dateErrId} className="field-error">{dateError}</span>}
        </div>
      )}
      <label className="block">
        <span className="eyebrow">Заметка · markdown</span>
        <textarea
          name="note"
          rows={3}
          value={values.note}
          onChange={(e) => set({ note: e.target.value })}
          className="input"
        />
      </label>
      <label className="block">
        <span className="eyebrow">Теги · через запятую</span>
        <input
          name="tags"
          autoComplete="off"
          value={values.tags}
          onChange={(e) => set({ tags: e.target.value })}
          className="input"
        />
      </label>
    </div>
  );
}
