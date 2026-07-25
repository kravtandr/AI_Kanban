import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { Project, Status } from "../types";
import { STATUSES } from "../types";
import Modal from "./Modal";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

interface Props {
  status: Status;
  projects: Project[];
  onClose: () => void;
}

/** Plain (non-AI) task creation straight into a chosen column. */
export default function NewTaskModal({ status, projects, onClose }: Props) {
  const makeInitial = (): TaskFormValues => {
    const inbox = projects.find((p) => p.is_inbox);
    return {
      title: "",
      description: "",
      project_id: inbox?.id ?? projects[0]?.id ?? 0,
      status,
      priority: "medium",
      tags: "",
      due_date: "",
    };
  };
  const [initial, setInitial] = useState<TaskFormValues>(makeInitial);
  const [form, setForm] = useState<TaskFormValues>(initial);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Проекты могли догрузиться после открытия модалки — подставляем инбокс
  // вместо невалидного project_id: 0 (и не считаем это dirty-правкой).
  useEffect(() => {
    if (projects.length === 0) return;
    const pid = projects.find((p) => p.is_inbox)?.id ?? projects[0].id;
    setForm((f) => (f.project_id === 0 ? { ...f, project_id: pid } : f));
    setInitial((f) => (f.project_id === 0 ? { ...f, project_id: pid } : f));
    setFormError(null);
  }, [projects]);

  const projectsReady = projects.length > 0;
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  // Esc, клик по подложке и «Отмена» идут сюда: набранный текст
  // не должен молча пропасть.
  const requestClose = () => {
    if (dirty && !window.confirm("Есть несохранённые изменения. Закрыть?")) return;
    onClose();
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.createTask({
        title: form.title,
        description: form.description,
        project_id: form.project_id,
        status: form.status,
        priority: form.priority,
        tags: parseTags(form.tags),
        due_date: form.due_date || null,
        source: "manual",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const columnTitle = STATUSES.find((s) => s.id === status)?.title ?? status;

  // Кнопка активна всегда до старта запроса: причину отказа объясняем
  // текстом, а не погасшей кнопкой.
  const create = () => {
    if (createMutation.isPending) return;
    if (!form.title.trim()) {
      setTitleError("Введите название задачи");
      titleRef.current?.focus();
      return;
    }
    setTitleError(null);
    // Без загруженных проектов project_id был бы 0 — не даём отправить
    if (!projectsReady) {
      setFormError("Проекты ещё не загружены — подождите пару секунд и повторите");
      return;
    }
    setFormError(null);
    createMutation.mutate();
  };

  return (
    <Modal onClose={requestClose} onSubmit={create} title={`Новая задача — ${columnTitle}`}>
      <div aria-live="polite">
        {createMutation.isError && (
          <p className="mb-3 text-sm text-danger">Не удалось создать задачу — попробуйте ещё раз</p>
        )}
        {formError && <p className="mb-3 text-sm text-danger">{formError}</p>}
        {!projectsReady && !formError && (
          <p className="mb-3 text-sm text-amber">Проекты ещё не загружены — создание пока недоступно</p>
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
      <div className="mt-5 flex justify-end gap-2">
        <button onClick={requestClose} className="btn-ghost">
          Отмена
        </button>
        <button onClick={create} disabled={createMutation.isPending} className="btn-primary">
          {createMutation.isPending ? "Создаю…" : "Создать"}
        </button>
      </div>
    </Modal>
  );
}
