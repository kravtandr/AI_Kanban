import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api } from "../api";
import { invalidateExpenses } from "../lib/invalidateExpenses";
import { parseRub } from "../lib/money";
import type { ExpenseStatus } from "../types";
import ExpenseForm, { emptyExpenseForm, formToBody, type ExpenseFormValues } from "./ExpenseForm";
import Modal from "./Modal";

interface Props {
  status: ExpenseStatus;
  /** Предзаполнение из черновика LLM (ExpenseQuickAdd). */
  initial?: ExpenseFormValues;
  aiNote?: string | null;
  source?: "manual" | "ai";
  aiMeta?: unknown;
  onClose: () => void;
}

export default function NewExpenseModal({
  status, initial, aiNote = null, source = "manual", aiMeta, onClose,
}: Props) {
  const [form, setForm] = useState<ExpenseFormValues>(() => initial ?? emptyExpenseForm(status));
  const [titleError, setTitleError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const anchorDateRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: () => api.createExpense({ ...formToBody(form), source, ai_meta: aiMeta }),
    onSuccess: () => {
      invalidateExpenses(queryClient);
      onClose();
    },
  });

  /** Round 2: то же лечение, что и в ExpenseModal — dateError завязан на то,
   * какое поле даты сейчас смонтировано (anchor_date vs purchased_at), а это
   * решает form.status. Смена статуса обязана сбрасывать dateError, иначе
   * старое сообщение всплывает под другим, только что показанным полем.
   * titleError/amountError не трогаем: их поля от статуса не зависят и
   * видимость не меняют. */
  const handleFormChange = (next: ExpenseFormValues) => {
    if (next.status !== form.status) setDateError(null);
    setForm(next);
  };

  const submit = () => {
    if (createMutation.isPending) return;
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
    // required у поля даты — без этой проверки сервер ответил бы 400 на
    // `status: "recurring", anchor_date: null`, и UI показал бы сырую ошибку.
    if (form.status === "recurring" && !form.anchor_date) {
      setDateError("У регулярной траты нужна дата списания");
      anchorDateRef.current?.focus();
      return;
    }
    setDateError(null);
    createMutation.mutate();
  };

  return (
    <Modal onClose={onClose} onSubmit={submit} title="Новая трата">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        {aiNote && <p className="rounded-lg bg-ai/10 px-3 py-2 text-xs text-ai">{aiNote}</p>}
        <ExpenseForm
          values={form}
          onChange={handleFormChange}
          titleError={titleError}
          amountError={amountError}
          dateError={dateError}
          titleRef={titleRef}
          amountRef={amountRef}
          anchorDateRef={anchorDateRef}
        />
        {createMutation.error instanceof Error && (
          <p className="text-sm text-danger">{createMutation.error.message}</p>
        )}
        <div className="flex gap-2">
          <button type="submit" className="btn-primary" disabled={createMutation.isPending}>
            Создать
          </button>
          <button type="button" className="btn-ghost" onClick={onClose}>
            Отмена
          </button>
        </div>
      </form>
    </Modal>
  );
}
