import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { DraftResponse, Project } from "../types";
import Modal from "./Modal";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

interface Props {
  projects: Project[];
}

export default function QuickAdd({ projects }: Props) {
  const [text, setText] = useState("");
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [form, setForm] = useState<TaskFormValues | null>(null);
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

  const draftMutation = useMutation({
    mutationFn: api.draft,
    onSuccess: (response) => {
      setDraft(response);
      setForm({
        title: response.draft.title,
        description: response.draft.description,
        project_id: response.project_id,
        status: "todo",
        priority: response.draft.priority,
        tags: response.draft.tags.join(", "),
        due_date: response.draft.due_date ?? "",
      });
    },
  });

  const createMutation = useMutation({
    mutationFn: api.createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      setDraft(null);
      setForm(null);
      setText("");
    },
  });

  function submitText(event: React.FormEvent) {
    event.preventDefault();
    if (text.trim()) draftMutation.mutate(text.trim());
  }

  function createTask() {
    if (!form || !draft) return;
    createMutation.mutate({
      title: form.title,
      description: form.description,
      project_id: form.project_id,
      status: form.status,
      priority: form.priority,
      tags: parseTags(form.tags),
      due_date: form.due_date || null,
      source: draft.ai_ok ? "ai" : "manual",
      ai_meta: draft.ai_ok ? { source_text: text } : undefined,
    });
  }

  function closeDraft() {
    setDraft(null);
    setForm(null);
  }

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
          disabled={draftMutation.isPending || !text.trim()}
          className="shrink-0 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          {draftMutation.isPending ? "✨ Думаю…" : "✨ Добавить"}
        </button>
      </form>

      {form && draft && (
        <Modal onClose={closeDraft}>
          <h3 className="mb-1 text-lg font-semibold">Черновик задачи</h3>
          {draft.ai_ok ? (
            <p className="mb-4 text-xs text-violet-600">✨ Оформлено AI — проверьте и создайте</p>
          ) : (
            <p className="mb-4 text-xs text-amber-600">
              ⚠️ AI недоступен ({draft.ai_error}) — задача будет создана как есть
            </p>
          )}
          <TaskForm values={form} projects={projects} onChange={setForm} showStatus />
          <div className="mt-5 flex justify-end gap-2">
            <button
              onClick={closeDraft}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              onClick={createTask}
              disabled={createMutation.isPending || !form.title.trim()}
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
