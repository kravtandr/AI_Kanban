import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
  const queryClient = useQueryClient();

  // Проекты могли догрузиться после открытия модалки — подставляем инбокс
  // вместо невалидного project_id: 0 (и не считаем это dirty-правкой).
  useEffect(() => {
    if (projects.length === 0) return;
    const pid = projects.find((p) => p.is_inbox)?.id ?? projects[0].id;
    setForm((f) => (f.project_id === 0 ? { ...f, project_id: pid } : f));
    setInitial((f) => (f.project_id === 0 ? { ...f, project_id: pid } : f));
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

  const create = () => {
    // Без загруженных проектов project_id был бы 0 — не даём отправить
    if (form.title.trim() && projectsReady && !createMutation.isPending) createMutation.mutate();
  };

  return (
    <Modal onClose={requestClose} onSubmit={create}>
      <h3 className="mb-4 text-lg font-semibold">Новая задача — {columnTitle}</h3>
      {createMutation.isError && (
        <p className="mb-3 text-sm text-danger">Не удалось создать задачу — попробуйте ещё раз</p>
      )}
      {!projectsReady && (
        <p className="mb-3 text-sm text-amber">
          Проекты ещё не загружены — создание пока недоступно
        </p>
      )}
      <TaskForm values={form} projects={projects} onChange={setForm} showStatus />
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={requestClose}
          className="btn-ghost"
        >
          Отмена
        </button>
        <button
          onClick={create}
          disabled={createMutation.isPending || !form.title.trim() || !projectsReady}
          title={!projectsReady ? "Проекты ещё не загружены" : undefined}
          className="btn-primary"
        >
          {createMutation.isPending ? "Создаю…" : "Создать"}
        </button>
      </div>
    </Modal>
  );
}
