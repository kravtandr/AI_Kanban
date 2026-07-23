import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../api";
import type { Project, Task } from "../types";
import Modal from "./Modal";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

interface Props {
  task: Task;
  projects: Project[];
  onClose: () => void;
}

export default function TaskModal({ task, projects, onClose }: Props) {
  const [form, setForm] = useState<TaskFormValues>({
    title: task.title,
    description: task.description,
    project_id: task.project_id,
    status: task.status,
    priority: task.priority,
    tags: task.tags.join(", "),
    due_date: task.due_date ?? "",
  });
  const [aiNote, setAiNote] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patchTask(task.id, {
        title: form.title,
        description: form.description,
        project_id: form.project_id,
        status: form.status,
        priority: form.priority,
        tags: parseTags(form.tags),
        due_date: form.due_date || undefined,
        clear_due_date: !form.due_date,
      }),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      invalidate();
      onClose();
    },
  });

  const enhanceMutation = useMutation({
    mutationFn: () => api.enhance(task.id),
    onSuccess: (response) => {
      if (response.ai_ok) {
        setForm((prev) => ({
          ...prev,
          title: response.draft.title,
          description: response.draft.description || prev.description,
          priority: response.draft.priority,
          tags: response.draft.tags.length ? response.draft.tags.join(", ") : prev.tags,
        }));
        setAiNote("✨ AI предложил изменения — проверьте и сохраните");
      } else {
        setAiNote(`⚠️ AI недоступен: ${response.ai_error}`);
      }
    },
  });

  return (
    <Modal onClose={onClose}>
      <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Задача #{task.id}</h3>
          <button
            onClick={() => enhanceMutation.mutate()}
            disabled={enhanceMutation.isPending}
            className="rounded-lg bg-violet-100 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-200 disabled:opacity-50"
          >
            {enhanceMutation.isPending ? "✨ Думаю…" : "✨ Оформить"}
          </button>
        </div>
        {aiNote && <p className="mb-3 text-xs text-violet-600">{aiNote}</p>}
        <TaskForm values={form} projects={projects} onChange={setForm} showStatus />
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => {
              if (window.confirm("Удалить задачу?")) deleteMutation.mutate();
            }}
            className="rounded-lg px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
          >
            Удалить
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Отмена
            </button>
            <button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || !form.title.trim()}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            >
              Сохранить
            </button>
          </div>
        </div>
    </Modal>
  );
}
