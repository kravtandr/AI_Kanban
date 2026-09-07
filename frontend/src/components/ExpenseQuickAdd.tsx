import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { kopecksToInput } from "../lib/money";
import { appendTranscript, useDictation } from "../lib/useDictation";
import type { ExpenseDraftResponse } from "../types";
import { emptyExpenseForm, type ExpenseFormValues } from "./ExpenseForm";
import MicButton from "./MicButton";
import NewExpenseModal from "./NewExpenseModal";

interface Pending {
  form: ExpenseFormValues;
  aiNote: string | null;
  aiMeta: unknown;
  source: "manual" | "ai";
}

function draftToForm(resp: ExpenseDraftResponse): ExpenseFormValues {
  const d = resp.draft;
  const base = emptyExpenseForm(d.status);
  return {
    ...base,
    title: d.title,
    amount: resp.amount ? kopecksToInput(resp.amount) : "",
    status: d.status,
    period: d.period ?? "month",
    anchor_date: d.anchor_date ?? base.anchor_date,
    tags: d.tags.join(", "),
  };
}

/** Быстрый ввод траты: один текст → один черновик → модалка с формой.
 * Без лотка черновиков QuickAdd: тратам пакетный ввод не нужен. Хоткей `n`
 * вешает этот компонент, а не глобальный слой — на доске задач он по-прежнему
 * открывает ввод задачи (QuickAdd — отдельный, нетронутый компонент). */
export default function ExpenseQuickAdd() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const dictation = useDictation((t) => setText((prev) => appendTranscript(prev, t)));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.key === "n" &&
        !event.metaKey && // не воровать браузерные Cmd+N / Ctrl+N
        !event.ctrlKey &&
        !event.altKey &&
        !target.isContentEditable &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    try {
      const resp = await api.draftExpense(value);
      setPending({
        form: draftToForm(resp),
        aiNote: resp.ai_ok ? null : `AI недоступен: ${resp.ai_error ?? "ошибка"} — заполните поля вручную`,
        aiMeta: { raw_text: value, ai_ok: resp.ai_ok },
        source: resp.ai_ok ? "ai" : "manual",
      });
      setText("");
    } catch (err) {
      // Деградация обязана сработать и на брошенном запросе (сеть, 5xx), не
      // только на ai_ok: false — форма всё равно открывается с тем, что
      // известно (исходный текст как название), и предупреждение называет
      // причину, а не молчит.
      setPending({
        form: { ...emptyExpenseForm("wanted"), title: value },
        aiNote: `AI недоступен: ${err instanceof Error ? err.message : "ошибка"} — заполните поля вручную`,
        aiMeta: null,
        source: "manual",
      });
      setText("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={submit} className="flex w-full max-w-xl items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="новая трата: «нетфликс 899 15 числа»"
          aria-label="Быстрый ввод траты"
          disabled={busy}
          className="input"
        />
        <MicButton dictation={dictation} target="трату" compact />
      </form>
      {pending && (
        <NewExpenseModal
          status={pending.form.status}
          initial={pending.form}
          aiNote={pending.aiNote}
          source={pending.source}
          aiMeta={pending.aiMeta}
          onClose={() => setPending(null)}
        />
      )}
    </>
  );
}
