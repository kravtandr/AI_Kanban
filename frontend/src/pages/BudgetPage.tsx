import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import BudgetGoals from "../components/BudgetGoals";
import NavTabs from "../components/NavTabs";
import { formatRub, kopecksToInput, parseRub } from "../lib/money";
import type { MonthlyBudget } from "../types";

const MONTH_PATTERN = "[1-9][0-9]{3}-(0[1-9]|1[0-2])";
const VALID_MONTH = new RegExp(`^${MONTH_PATTERN}$`);
const MAX_RECEIPTS = 100;
const MAX_AMOUNT = 10_000_000_000; // Копейки

interface Draft {
  salary: string;
  freelance: { id: number; title: string; amount: string }[];
}

function currentMonth() {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

function toDraft(budget: MonthlyBudget): Draft {
  return {
    salary: budget.salary ? kopecksToInput(budget.salary) : "",
    freelance: budget.freelance.map(({ title, amount }, index) => ({
      id: index, title, amount: kopecksToInput(amount),
    })),
  };
}

function parseBudgetAmount(raw: string, minimum: number) {
  const amount = parseRub(raw);
  return amount !== null && amount >= minimum && amount <= MAX_AMOUNT ? amount : null;
}

export default function BudgetPage() {
  const [month, setMonth] = useState(currentMonth);
  const [monthInput, setMonthInput] = useState(month);
  const [draft, setDraft] = useState<Draft | null>(null);
  const nextReceiptId = useRef(MAX_RECEIPTS);
  const queryClient = useQueryClient();
  const budget = useQuery({ queryKey: ["budget", month], queryFn: () => api.budget(month) });
  const save = useMutation({
    mutationFn: ({ month, body }: { month: string; body: MonthlyBudget }) =>
      api.saveBudget(month, body),
    onSuccess: async (saved, { month }) => {
      await queryClient.cancelQueries({ queryKey: ["budget", month] });
      queryClient.setQueryData(["budget", month], saved);
      setDraft(null);
    },
  });

  const form = draft ?? (budget.data ? toDraft(budget.data) : null);
  const salary = form ? parseBudgetAmount(form.salary.trim() || "0", 0) : null;
  const receipts = form?.freelance.map(({ title, amount }) => ({
    title: title.trim(),
    amount: parseBudgetAmount(amount, 1),
  })) ?? [];
  const completeReceipts = receipts.filter((receipt): receipt is MonthlyBudget["freelance"][number] =>
    receipt.amount !== null,
  );
  const valid = salary !== null && completeReceipts.length === receipts.length;
  const freelanceTotal = completeReceipts.reduce((sum, receipt) => sum + receipt.amount, 0);
  const income = valid && salary !== null ? salary + freelanceTotal : null;

  function changeMonth(value: string) {
    setMonthInput(value);
    if (!VALID_MONTH.test(value) || value === month) return;
    if (draft && !window.confirm("Переключить месяц без сохранения изменений?")) {
      setMonthInput(month);
      return;
    }
    save.reset();
    setDraft(null);
    setMonth(value);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || save.isPending || !valid || salary === null) return;
    save.mutate({ month, body: { salary, freelance: completeReceipts } });
  }

  function updateReceipt(id: number, patch: { title?: string; amount?: string }) {
    if (!form) return;
    setDraft({
      ...form,
      freelance: form.freelance.map((receipt) => receipt.id === id ? { ...receipt, ...patch } : receipt),
    });
  }

  function logout() {
    void api.logout().catch(() => undefined).finally(() => window.location.assign("/login"));
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge/70 bg-surface p-3 md:px-5">
        <h1 className="shrink-0 font-mono text-base font-medium"><span className="caret">tasktracker</span></h1>
        <NavTabs />
        <button type="button" onClick={logout} className="ml-auto font-mono text-xs text-dim hover:text-ink">
          выйти
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-2xl font-semibold">Бюджет</h2>
              <p className="mt-1 text-sm text-dim">Зарплата, фриланс и цели за выбранный месяц</p>
            </div>
            <label className="text-sm text-dim">
              Месяц бюджета
              <input
                type="month" className="input mt-1" pattern={MONTH_PATTERN} placeholder="ГГГГ-ММ"
                min="1000-01" max="9999-12" value={monthInput} disabled={save.isPending}
                onChange={(event) => changeMonth(event.target.value)} onBlur={() => setMonthInput(month)}
              />
            </label>
          </div>

          {budget.isPending && <p role="status" className="text-dim">Загружаем бюджет…</p>}
          {budget.isError && !form && (
            <div role="alert" className="rounded-xl border border-edge bg-surface p-4">
              <p>Не удалось загрузить бюджет.</p>
              <button type="button" className="btn-ghost mt-2" onClick={() => void budget.refetch()}>Повторить</button>
            </div>
          )}

          {form && (
            <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <form onSubmit={submit} className="rounded-xl border border-edge bg-surface p-4 sm:p-6">
                <div className="border-b border-edge pb-4">
                  <h3 className="text-lg font-medium">Доход за месяц</h3>
                  <p className="mt-1 font-mono text-2xl font-medium break-words">{income === null ? "—" : formatRub(income)}</p>
                  <p className="mt-1 text-sm text-dim">Зарплата + поступления за заказы</p>
                </div>

                <fieldset disabled={save.isPending} className="mt-4 min-w-0 space-y-4">
                  <label className="block text-sm">
                    Зарплата, ₽
                    <input
                      className="input mt-1" inputMode="decimal" placeholder="0"
                      value={form.salary} aria-invalid={salary === null}
                      onChange={(event) => setDraft({ ...form, salary: event.target.value })}
                    />
                  </label>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h4 className="text-sm font-medium">Фриланс-поступления</h4>
                    <span className="font-mono text-sm text-dim">{formatRub(freelanceTotal)}</span>
                  </div>
                  {form.freelance.length === 0 && <p className="text-sm text-dim">За этот месяц пока нет поступлений.</p>}
                  <ul className="space-y-2">
                    {form.freelance.map((receipt, index) => (
                      <li key={receipt.id} className="grid grid-cols-[minmax(0,1fr)_minmax(5rem,8rem)_auto] items-center gap-2">
                        <input
                          aria-label={`Заказ ${index + 1}`} placeholder="Название заказа"
                          className="input min-w-0" maxLength={200} value={receipt.title}
                          onChange={(event) => updateReceipt(receipt.id, { title: event.target.value })}
                        />
                        <input
                          aria-label={`Сумма заказа ${index + 1}, ₽`} placeholder="Сумма, ₽"
                          className="input min-w-0" inputMode="decimal" value={receipt.amount}
                          aria-invalid={receipt.amount !== "" && receipts[index]?.amount === null}
                          onChange={(event) => updateReceipt(receipt.id, { amount: event.target.value })}
                        />
                        <button
                          type="button" className="btn-icon" aria-label={`Удалить поступление ${index + 1}`}
                          onClick={() => setDraft({ ...form, freelance: form.freelance.filter(({ id }) => id !== receipt.id) })}
                        >
                          <span aria-hidden="true">×</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <button
                    type="button" className="btn-ghost border border-edge disabled:opacity-40"
                    disabled={form.freelance.length >= MAX_RECEIPTS}
                    onClick={() => setDraft({
                      ...form, freelance: [...form.freelance, { id: nextReceiptId.current++, title: "", amount: "" }],
                    })}
                  >
                    <span aria-hidden="true">+ </span>Добавить поступление
                  </button>
                  {!valid && <p className="text-sm text-dim">Укажите суммы в рублях с точностью до копеек. Поступление должно быть больше нуля.</p>}
                  <div className="flex flex-wrap items-center gap-3 border-t border-edge pt-4">
                    <button className="btn-primary" type="submit" disabled={!draft || !valid || save.isPending}>
                      {save.isPending ? "Сохраняем…" : "Сохранить месяц"}
                    </button>
                    {save.isSuccess && !draft && <span role="status" className="text-sm text-mcp">Сохранено</span>}
                    {save.isError && <p role="alert" className="text-sm text-danger">Не удалось сохранить. Попробуйте ещё раз.</p>}
                  </div>
                </fieldset>
              </form>
              <BudgetGoals income={income} />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
