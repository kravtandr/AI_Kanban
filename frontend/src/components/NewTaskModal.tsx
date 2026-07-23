import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
  const inbox = projects.find((p) => p.is_inbox);
  const [form, setForm] = useState<TaskFormValues>({
    title: "",
    description: "",
    project_id: inbox?.id ?? projects[0]?.id ?? 0,
    status,
    priority: "medium",
    tags: "",
    due_date: "",
  });
  const queryClient = useQueryClient();

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

  return (
    <Modal onClose={onClose}>
      <h3 className="mb-4 text-lg font-semibold">Новая задача — {columnTitle}</h3>
      <TaskForm values={form} projects={projects} onChange={setForm} showStatus />
      <div className="mt-5 flex justify-end gap-2">
        <button
          onClick={onClose}
          className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          Отмена
        </button>
        <button
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending || !form.title.trim()}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Создать
        </button>
      </div>
    </Modal>
  );
}
