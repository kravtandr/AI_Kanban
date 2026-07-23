import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import type { Project } from "../types";
import { PRIORITIES } from "../types";
import Modal from "./Modal";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

interface Props {
  projects: Project[];
}

interface DraftItem {
  id: number;
  text: string;
  status: "pending" | "ready" | "creating";
  aiOk?: boolean;
  aiError?: string | null;
  form?: TaskFormValues;
}

/** AI quick-add with a draft queue: Enter fires the LLM request and frees the
 * input immediately; drafts pile up in a tray and are approved one by one or
 * all at once (batch). */
export default function QuickAdd({ projects }: Props) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<DraftItem[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const nextId = useRef(1);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (event.key === "n" && !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inboxId = projects.find((p) => p.is_inbox)?.id ?? projects[0]?.id ?? 0;

  const patchItem = (id: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  async function submitText(event: React.FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setText(""); // free the input right away — keep typing while the LLM thinks
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, text: value, status: "pending" }]);
    try {
      const resp = await api.draft(value);
      patchItem(id, {
        status: "ready",
        aiOk: resp.ai_ok,
        aiError: resp.ai_error,
        form: {
          title: resp.draft.title,
          description: resp.draft.description,
          project_id: resp.project_id,
          status: "todo",
          priority: resp.draft.priority,
          tags: resp.draft.tags.join(", "),
          due_date: resp.draft.due_date ?? "",
        },
      });
    } catch (err) {
      patchItem(id, {
        status: "ready",
        aiOk: false,
        aiError: err instanceof Error ? err.message : "сеть недоступна",
        form: {
          title: value,
          description: "",
          project_id: inboxId,
          status: "todo",
          priority: "medium",
          tags: "",
          due_date: "",
        },
      });
    }
  }

  async function createItem(item: DraftItem) {
    if (!item.form || item.status !== "ready") return;
    patchItem(item.id, { status: "creating" });
    try {
      await api.createTask({
        title: item.form.title,
        description: item.form.description,
        project_id: item.form.project_id,
        status: item.form.status,
        priority: item.form.priority,
        tags: parseTags(item.form.tags),
        due_date: item.form.due_date || null,
        source: item.aiOk ? "ai" : "manual",
        ai_meta: item.aiOk ? { source_text: item.text } : undefined,
      });
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      patchItem(item.id, { status: "ready", aiError: "не удалось создать" });
    }
  }

  async function createAll() {
    for (const item of items.filter((it) => it.status === "ready")) {
      await createItem(item);
    }
  }

  const readyCount = items.filter((it) => it.status === "ready").length;
  const editingItem = items.find((it) => it.id === editingId);
  const projectName = (id: number) => projects.find((p) => p.id === id)?.name ?? "";

  return (
    <>
      <form onSubmit={submitText} className="flex gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Новая задача… (n)"
          className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm md:w-96 dark:border-slate-700 dark:bg-slate-900"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          ✨ Добавить
        </button>
      </form>

      {items.length > 0 &&
        createPortal(
          <div className="fixed inset-x-2 bottom-2 z-40 md:inset-x-auto md:right-4 md:bottom-4 md:w-[26rem]">
            <div className="max-h-[60vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Черновики · {items.length}</span>
                {readyCount > 0 && (
                  <button
                    onClick={createAll}
                    className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 dark:bg-slate-100 dark:text-slate-900"
                  >
                    Создать все ({readyCount})
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-slate-200 p-2.5 dark:border-slate-700"
                  >
                    {item.status === "pending" ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
                        <span className="truncate">✨ Думаю: {item.text}</span>
                      </div>
                    ) : (
                      <>
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="text-sm font-medium leading-snug">
                            {item.form?.title}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => setEditingId(item.id)}
                              title="Редактировать"
                              className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => createItem(item)}
                              disabled={item.status === "creating"}
                              title="Создать задачу"
                              className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() =>
                                setItems((prev) => prev.filter((it) => it.id !== item.id))
                              }
                              title="Отбросить черновик"
                              className="rounded-md px-1.5 py-0.5 text-xs text-slate-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {projectName(item.form?.project_id ?? 0)}
                          </span>
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {PRIORITIES.find((p) => p.id === item.form?.priority)?.title}
                          </span>
                          {item.form?.due_date && (
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              до {item.form.due_date}
                            </span>
                          )}
                          {!item.aiOk && (
                            <span
                              title={item.aiError ?? undefined}
                              className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700"
                            >
                              ⚠️ без AI
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {editingItem?.form && (
        <Modal onClose={() => setEditingId(null)}>
          <h3 className="mb-4 text-lg font-semibold">Черновик задачи</h3>
          <TaskForm
            values={editingItem.form}
            projects={projects}
            onChange={(form) => patchItem(editingItem.id, { form })}
            showStatus
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={() => setEditingId(null)}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Закрыть
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                void createItem(editingItem);
              }}
              disabled={!editingItem.form.title.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              Создать
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
