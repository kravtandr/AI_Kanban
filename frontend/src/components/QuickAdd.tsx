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

/** Командная строка задач: Enter отправляет текст модели и сразу освобождает
 * ввод; черновики копятся в лотке и одобряются по одному или пачкой. */
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
    setText(""); // поле свободно — печатайте следующую, пока модель думает
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
      <form onSubmit={submitText} className="relative flex gap-2">
        <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-amber">
          ›
        </span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="опиши задачу — ai оформит  (n)"
          className="input py-2.5 pl-8 font-mono text-[13px] md:w-96"
        />
        <button type="submit" disabled={!text.trim()} className="btn-primary shrink-0">
          Добавить
        </button>
      </form>

      {items.length > 0 &&
        createPortal(
          <div className="fixed inset-x-2 bottom-2 z-40 md:inset-x-auto md:right-4 md:bottom-4 md:w-[26rem]">
            <div className="max-h-[60vh] overflow-y-auto rounded-xl border border-edge bg-surface p-3 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[0.16em] text-dim uppercase">
                  черновики · {items.length}
                </span>
                {readyCount > 0 && (
                  <button onClick={createAll} className="btn-primary px-3 py-1.5 text-xs">
                    Создать все ({readyCount})
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border border-edge bg-card p-2.5 ${
                      item.status === "ready" ? "draft-ready" : ""
                    }`}
                  >
                    {item.status === "pending" ? (
                      <div className="flex items-center gap-2 font-mono text-xs text-dim">
                        <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ai border-t-transparent" />
                        <span className="truncate">думаю: {item.text}</span>
                      </div>
                    ) : (
                      <>
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="text-sm leading-snug font-medium">
                            {item.form?.title}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => setEditingId(item.id)}
                              title="Редактировать"
                              className="rounded-md px-1.5 py-0.5 text-xs text-dim transition hover:bg-edge/50 hover:text-ink"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => createItem(item)}
                              disabled={item.status === "creating"}
                              title="Создать задачу"
                              className="rounded-md bg-amber px-1.5 py-0.5 text-xs font-semibold text-night transition hover:brightness-110 disabled:opacity-40"
                            >
                              ✓
                            </button>
                            <button
                              onClick={() =>
                                setItems((prev) => prev.filter((it) => it.id !== item.id))
                              }
                              title="Отбросить черновик"
                              className="rounded-md px-1.5 py-0.5 text-xs text-dim transition hover:bg-danger/15 hover:text-danger"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-dim">
                          <span>{projectName(item.form?.project_id ?? 0)}</span>
                          <span>
                            {PRIORITIES.find((p) => p.id === item.form?.priority)?.title.toLowerCase()}
                          </span>
                          {item.form?.due_date && <span>до {item.form.due_date}</span>}
                          {!item.aiOk && (
                            <span className="text-amber" title={item.aiError ?? undefined}>
                              ⚠ без ai
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
            <button onClick={() => setEditingId(null)} className="btn-ghost">
              Закрыть
            </button>
            <button
              onClick={() => {
                setEditingId(null);
                void createItem(editingItem);
              }}
              disabled={!editingItem.form.title.trim()}
              className="btn-primary"
            >
              Создать
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
