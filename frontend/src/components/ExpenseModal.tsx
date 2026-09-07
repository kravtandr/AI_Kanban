import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { invalidateExpenses } from "../lib/invalidateExpenses";
import { kopecksToInput, parseRub } from "../lib/money";
import type { Expense } from "../types";
import ExpenseForm, { type ExpenseFormValues } from "./ExpenseForm";
import Modal from "./Modal";
import { parseTags } from "./TaskForm";

interface Props {
  expense: Expense;
  onClose: () => void;
}

type PatchBody = Partial<Expense> & { clear_period?: boolean };

/** Взвод «Точно удалить?» сам снимается через это время — иначе клик по
 * забытой открытой модалке спустя долгое время удалил бы трату неожиданно. */
const DELETE_CONFIRM_TIMEOUT_MS = 4000;
/** Кнопка подтверждения — тот же DOM-узел, что и «Удалить»: двойной клик
 * (один физический жест) бьёт по нему дважды почти мгновенно. Подтверждение
 * раньше этого порога после взвода игнорируется как часть того же клика. */
const DELETE_CONFIRM_THRESHOLD_MS = 400;

function toFormValues(e: Expense): ExpenseFormValues {
  return {
    title: e.title,
    amount: kopecksToInput(e.amount),
    status: e.status,
    period: e.period ?? "month",
    anchor_date: e.anchor_date ?? "",
    purchased_at: e.purchased_at ?? "",
    note: e.note,
    tags: e.tags.join(", "),
    active: e.active,
  };
}

export default function ExpenseModal({ expense, onClose }: Props) {
  const [initial] = useState(() => toFormValues(expense));
  const [form, setForm] = useState(initial);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const anchorDateRef = useRef<HTMLInputElement>(null);
  const purchasedAtRef = useRef<HTMLInputElement>(null);
  const confirmDeleteAtRef = useRef(0);
  const queryClient = useQueryClient();
  const done = () => {
    invalidateExpenses(queryClient);
    onClose();
  };

  // Разоружаем взвод по таймеру — см. DELETE_CONFIRM_TIMEOUT_MS.
  useEffect(() => {
    if (!confirmDelete) return;
    const timer = setTimeout(() => setConfirmDelete(false), DELETE_CONFIRM_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [confirmDelete]);

  /** Только изменённые поля (как TaskModal). Смена типа шлёт полный набор полей
   * нового статуса — сервер проверит инвариант (§7.1). */
  const buildPatch = (): PatchBody => {
    const patch: PatchBody = {};
    if (form.title !== initial.title) patch.title = form.title.trim();
    if (form.amount !== initial.amount) patch.amount = parseRub(form.amount) ?? 0;
    if (form.note !== initial.note) patch.note = form.note;
    const tags = parseTags(form.tags);
    if (JSON.stringify(tags) !== JSON.stringify(parseTags(initial.tags))) patch.tags = tags;
    const recurring = form.status === "recurring";
    if (form.status !== initial.status) patch.status = form.status;
    if (recurring) {
      if (form.period !== initial.period || patch.status) patch.period = form.period;
      if (form.anchor_date !== initial.anchor_date || patch.status) patch.anchor_date = form.anchor_date;
      if (form.active !== initial.active) patch.active = form.active;
    } else if (initial.status === "recurring") {
      patch.clear_period = true;
      if (!initial.active) patch.active = true;
    }
    if (form.status === "bought" && form.purchased_at !== initial.purchased_at) {
      patch.purchased_at = form.purchased_at || undefined;
    }
    return patch;
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const requestClose = () => {
    if (dirty && !window.confirm("Есть несохранённые изменения. Закрыть?")) return;
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: (body: PatchBody) => api.patchExpense(expense.id, body),
    onSuccess: done,
  });
  const deleteMutation = useMutation({ mutationFn: () => api.deleteExpense(expense.id), onSuccess: done });
  const buyMutation = useMutation({ mutationFn: () => api.moveExpense(expense.id, "bought"), onSuccess: done });

  const save = () => {
    if (saveMutation.isPending) return;
    if (!form.title.trim()) {
      setTitleError("Введите название");
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    if (parseRub(form.amount) === null) {
      setAmountError("Введите сумму в рублях");
      amountRef.current?.focus();
      return;
    }
    setAmountError(null);
    // Ctrl/Cmd+Enter (Modal.tsx) вызывает onSubmit напрямую, минуя HTML5
    // required у полей даты — обе проверки ниже обязаны жить в JS, а не
    // полагаться на браузерную валидацию формы.
    if (form.status === "recurring" && !form.anchor_date) {
      setDateError("У регулярной траты нужна дата списания");
      anchorDateRef.current?.focus();
      return;
    }
    if (form.status === "bought" && !form.purchased_at) {
      // Инвариант статуса требует у «Куплено» дату покупки — пустая не
      // является легальным состоянием, поэтому это ошибка, а не молчаливый
      // clear (JSON.stringify всё равно роняет undefined из патча).
      setDateError("Укажите дату покупки");
      purchasedAtRef.current?.focus();
      return;
    }
    setDateError(null);
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    saveMutation.mutate(patch);
  };

  /** Round 2: dateError описывает конкретное поле (anchor_date или
   * purchased_at), а эти поля меняют видимость по form.status — смена
   * статуса обязана сбрасывать dateError, иначе старое сообщение всплывает
   * под новым, только что показанным полем даты. titleError/amountError не
   * трогаем: их поля всегда на экране независимо от статуса, их корректность
   * от статуса не зависит, так что «не тому полю» здесь произойти не может. */
  const handleFormChange = (next: ExpenseFormValues) => {
    if (next.status !== form.status) setDateError(null);
    setForm(next);
  };

  const handleDeleteClick = () => {
    const now = Date.now();
    if (!confirmDelete) {
      setConfirmDelete(true);
      confirmDeleteAtRef.current = now;
      return;
    }
    if (now - confirmDeleteAtRef.current < DELETE_CONFIRM_THRESHOLD_MS) return;
    setConfirmDelete(false);
    deleteMutation.mutate();
  };

  const error = saveMutation.error ?? deleteMutation.error ?? buyMutation.error;

  return (
    <Modal onClose={requestClose} onSubmit={save} title="Трата">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="flex flex-col gap-4"
      >
        <ExpenseForm
          values={form}
          onChange={handleFormChange}
          titleError={titleError}
          amountError={amountError}
          dateError={dateError}
          titleRef={titleRef}
          amountRef={amountRef}
          anchorDateRef={anchorDateRef}
          purchasedAtRef={purchasedAtRef}
        />
        {error instanceof Error && <p className="text-sm text-danger">{error.message}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="btn-primary" disabled={saveMutation.isPending}>
            Сохранить
          </button>
          {expense.status === "wanted" && (
            <button type="button" className="btn-ghost" onClick={() => buyMutation.mutate()}>
              Куплено
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={requestClose}>
            Отмена
          </button>
          <button
            type="button"
            className="btn-ghost ml-auto text-danger"
            onClick={handleDeleteClick}
          >
            {confirmDelete ? "Точно удалить?" : "Удалить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
