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

type PatchBody = Partial<Task> & { clear_due_date?: boolean };

function toFormValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description,
    project_id: task.project_id,
    status: task.status,
    priority: task.priority,
    tags: task.tags.join(", "),
    due_date: task.due_date ?? "",
  };
}

export default function TaskModal({ task, projects, onClose }: Props) {
  const [initial] = useState<TaskFormValues>(() => toFormValues(task));
  const [form, setForm] = useState<TaskFormValues>(initial);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
  };

  // PATCH шлёт только изменённые поля: полный снапшот затирал бы
  // конкурентные правки MCP-агентов (FR-4.6).
  const buildPatch = (): PatchBody => {
    const patch: PatchBody = {};
    if (form.title !== initial.title) patch.title = form.title;
    if (form.description !== initial.description) patch.description = form.description;
    if (form.project_id !== initial.project_id) patch.project_id = form.project_id;
    if (form.status !== initial.status) patch.status = form.status;
    if (form.priority !== initial.priority) patch.priority = form.priority;
    const tags = parseTags(form.tags);
    if (JSON.stringify(tags) !== JSON.stringify(parseTags(initial.tags))) patch.tags = tags;
    if (form.due_date !== initial.due_date) {
      if (form.due_date) patch.due_date = form.due_date;
      else patch.clear_due_date = true;
    }
    return patch;
  };

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  // Esc, клик по подложке и «Отмена» идут сюда: несохранённые правки
  // не должны молча пропасть.
  const requestClose = () => {
    if (dirty && !window.confirm("Есть несохранённые изменения. Закрыть?")) return;
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: (body: PatchBody) => api.patchTask(task.id, body),
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

  const save = () => {
    if (!form.title.trim() || saveMutation.isPending) return;
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose(); // менять нечего — закрываем без запроса
      return;
    }
    saveMutation.mutate(patch);
  };

  return (
    <Modal onClose={requestClose} onSubmit={save}>
      <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Задача #{task.id}</h3>
          <button
            onClick={() => enhanceMutation.mutate()}
            disabled={enhanceMutation.isPending}
            className="btn-ai"
          >
            {enhanceMutation.isPending ? "✨ Думаю…" : "✨ Оформить"}
          </button>
        </div>
        {aiNote && <p className="mb-3 font-mono text-xs text-ai">{aiNote}</p>}
        {enhanceMutation.isError && (
          <p className="mb-3 text-sm text-danger">
            ⚠️ Не удалось запросить AI:{" "}
            {enhanceMutation.error instanceof Error
              ? enhanceMutation.error.message
              : "сеть недоступна"}
          </p>
        )}
        {(saveMutation.isError || deleteMutation.isError) && (
          <p className="mb-3 text-sm text-danger">
            {saveMutation.isError ? "Не удалось сохранить" : "Не удалось удалить"} — попробуйте ещё
            раз
          </p>
        )}
        <TaskForm values={form} projects={projects} onChange={setForm} showStatus />
        <div className="mt-5 flex items-center justify-between">
          <button
            onClick={() => {
              if (window.confirm("Удалить задачу?")) deleteMutation.mutate();
            }}
            className="btn-ghost text-danger hover:bg-danger/10 hover:text-danger"
          >
            Удалить
          </button>
          <div className="flex gap-2">
            <button
              onClick={requestClose}
              className="btn-ghost"
            >
              Отмена
            </button>
            <button
              onClick={save}
              disabled={saveMutation.isPending || !form.title.trim()}
              className="btn-primary"
            >
              {saveMutation.isPending ? "Сохраняю…" : "Сохранить"}
            </button>
          </div>
        </div>
    </Modal>
  );
}
