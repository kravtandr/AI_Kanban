import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { invalidateExpenses } from "../lib/invalidateExpenses";
import type { Expense } from "../types";
import Modal from "./Modal";

interface Props {
  expense: Expense;
  at: { x: number; y: number };
  onClose: () => void;
}

/** Tags come from the entire expense board, including paused entries. */
export default function ExpenseTagMenu({ expense, at, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef(document.activeElement as HTMLElement | null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();
  const tagsQuery = useQuery({
    queryKey: ["expenses", "tag-options"],
    queryFn: () => api.expenses(new URLSearchParams({ include_inactive: "true" })),
  });
  const tags = [...new Set([...expense.tags, ...(tagsQuery.data ?? []).flatMap((item) => item.tags)])]
    .sort((a, b) => a.localeCompare(b, "ru"));
  const mutation = useMutation({
    mutationFn: (nextTags: string[]) => api.patchExpense(expense.id, { tags: nextTags }),
    onSuccess: (saved) => {
      queryClient.setQueriesData<Expense[]>({ queryKey: ["expenses"] }, (old) =>
        old?.map((item) => item.id === saved.id ? saved : item));
      invalidateExpenses(queryClient);
      onClose();
    },
  });
  const saving = useRef(false);
  const save = (nextTags: string[]) => {
    if (saving.current) return;
    saving.current = true;
    mutation.mutate(nextTags, { onSettled: () => { saving.current = false; } });
  };
  const addTag = () => {
    const tag = name.trim().toLowerCase();
    if (!tag || saving.current) return;
    if (expense.tags.includes(tag)) { onClose(); return; }
    save([...expense.tags, tag]);
  };

  useEffect(() => () => opener.current?.focus?.(), []);
  useEffect(() => {
    if (creating) return;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const nodes = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
      if (!nodes.length) return;
      if (!["Tab", "ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const index = nodes.indexOf(document.activeElement as HTMLElement);
      const delta = event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey) ? -1 : 1;
      const next = event.key === "Home" ? 0 : event.key === "End" ? nodes.length - 1 : (index + delta + nodes.length) % nodes.length;
      nodes[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [creating, onClose]);

  const error = mutation.isError && <p role="alert" className="px-2 py-2 text-sm text-danger">Не удалось сохранить теги. Попробуйте ещё раз.</p>;
  if (creating) return (
    <Modal title="Новый тег" onClose={onClose} onSubmit={addTag}>
      <form onSubmit={(event) => { event.preventDefault(); addTag(); }}>
        <label className="mb-2 block text-sm" htmlFor="expense-tag-name">Название тега</label>
        <input id="expense-tag-name" className="input" value={name} onChange={(event) => setName(event.target.value)} disabled={mutation.isPending} placeholder="Например, подписки" />
        <p className="mt-2 text-xs text-dim">Тег будет добавлен к трате «{expense.title}».</p>
        {error}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose}>Отмена</button>
          <button type="submit" className="btn-primary" disabled={!name.trim() || mutation.isPending}>{mutation.isPending ? "Сохраняем…" : "Добавить тег"}</button>
        </div>
      </form>
    </Modal>
  );

  const isWide = window.innerWidth >= 640;
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 328));
  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} aria-hidden="true" />
      <div ref={ref} role="menu" aria-label="Теги траты" aria-busy={mutation.isPending}
        className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl border border-edge bg-card p-1.5 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:w-60 sm:rounded-lg"
        style={isWide ? { left, top, maxHeight: Math.min(320, window.innerHeight - 16) } : undefined}>
        <p className="eyebrow px-2 py-1.5">Теги</p>
        {tagsQuery.isPending && <p role="status" className="px-2 py-2 text-xs text-dim">Загружаем теги…</p>}
        {tagsQuery.isError && <>
          <p role="alert" className="px-2 py-2 text-xs text-danger">Не удалось загрузить список тегов.</p>
          <button type="button" role="menuitem" className="btn-ghost w-full text-left" onClick={() => { void tagsQuery.refetch(); }}>Повторить загрузку</button>
        </>}
        {tagsQuery.isSuccess && tags.length === 0 && <p className="px-2 py-2 text-sm text-dim">Тегов пока нет</p>}
        {tags.map((tag) => {
          const selected = expense.tags.includes(tag);
          return <button key={tag} type="button" role="menuitemcheckbox" aria-checked={selected} aria-disabled={mutation.isPending}
            onClick={() => save(selected ? expense.tags.filter((item) => item !== tag) : [...expense.tags, tag])}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-edge/40 aria-disabled:opacity-50">
            <span aria-hidden="true" className="font-mono text-dim">#</span>
            <span className="truncate" title={tag}>{tag}</span>
            {selected && <span aria-hidden="true" className="ml-auto font-mono text-xs text-amber">✓</span>}
          </button>;
        })}
        {error}
        <button type="button" role="menuitem" aria-disabled={mutation.isPending}
          onClick={() => { if (!saving.current) { mutation.reset(); setCreating(true); } }}
          className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-edge/60 px-2 py-2 text-left text-sm text-dim hover:bg-edge/40 hover:text-ink">
          <span aria-hidden="true" className="font-mono">+</span>Новый тег…
        </button>
      </div>
    </>, document.body,
  );
}
