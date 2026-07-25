import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
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
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
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
        setAiNote("AI предложил изменения — проверьте и сохраните");
      } else {
        setAiNote(`AI недоступен: ${response.ai_error} — заполните поля вручную`);
      }
    },
  });

  // Кнопка сабмита остаётся активной: пустое название объясняем инлайн
  // и уводим туда фокус, а не гасим кнопку без причины.
  const save = () => {
    if (saveMutation.isPending) return;
    if (!form.title.trim()) {
      setTitleError("Введите название задачи");
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    const patch = buildPatch();
    if (Object.keys(patch).length === 0) {
      onClose(); // менять нечего — закрываем без запроса
      return;
    }
    saveMutation.mutate(patch);
  };

  return (
    <Modal
      onClose={requestClose}
      onSubmit={save}
      title={`Задача #${task.id}`}
      headerAction={
        <button
          onClick={() => enhanceMutation.mutate()}
          disabled={enhanceMutation.isPending}
          className="btn-ai shrink-0"
        >
          <span aria-hidden="true">✨</span>{" "}
          {enhanceMutation.isPending ? "Думаю…" : "Оформить"}
        </button>
      }
    >
      {/* Живая область смонтирована всегда: содержимое, вставленное в уже
        существующий aria-live контейнер, зачитывается — в отличие от
        элемента, который сам появляется вместе с атрибутом. */}
      <div aria-live="polite">
        {aiNote && <p className="mb-3 font-mono text-xs text-ai">{aiNote}</p>}
        {enhanceMutation.isError && (
          <p className="mb-3 text-sm text-danger">
            Не удалось запросить AI:{" "}
            {enhanceMutation.error instanceof Error
              ? enhanceMutation.error.message
              : "сеть недоступна"}{" "}
            — проверьте соединение и попробуйте ещё раз
          </p>
        )}
        {(saveMutation.isError || deleteMutation.isError) && (
          <p className="mb-3 text-sm text-danger">
            {saveMutation.isError ? "Не удалось сохранить" : "Не удалось удалить"} — попробуйте ещё
            раз
          </p>
        )}
      </div>
      <TaskForm
        values={form}
        projects={projects}
        onChange={(next) => {
          setForm(next);
          if (titleError && next.title.trim()) setTitleError(null);
        }}
        showStatus
        titleError={titleError}
        titleRef={titleRef}
      />
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
          <button onClick={requestClose} className="btn-ghost">
            Отмена
          </button>
          <button onClick={save} disabled={saveMutation.isPending} className="btn-primary">
            {saveMutation.isPending ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
