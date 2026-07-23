import type { Priority, Project, Status } from "../types";
import { PRIORITIES, STATUSES } from "../types";

export interface TaskFormValues {
  title: string;
  description: string;
  project_id: number;
  status: Status;
  priority: Priority;
  tags: string;
  due_date: string;
}

interface Props {
  values: TaskFormValues;
  projects: Project[];
  onChange: (values: TaskFormValues) => void;
  showStatus?: boolean;
}

const inputCls =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-800";

export default function TaskForm({ values, projects, onChange, showStatus = false }: Props) {
  const set = (patch: Partial<TaskFormValues>) => onChange({ ...values, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Название</span>
        <input
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          maxLength={200}
          required
          className={inputCls}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Описание (Markdown)</span>
        <textarea
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={5}
          className={inputCls}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Проект</span>
          <select
            value={values.project_id}
            onChange={(e) => set({ project_id: Number(e.target.value) })}
            className={inputCls}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Приоритет</span>
          <select
            value={values.priority}
            onChange={(e) => set({ priority: e.target.value as Priority })}
            className={inputCls}
          >
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {showStatus && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500">Колонка</span>
            <select
              value={values.status}
              onChange={(e) => set({ status: e.target.value as Status })}
              className={inputCls}
            >
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-slate-500">Срок</span>
          <input
            type="date"
            value={values.due_date}
            onChange={(e) => set({ due_date: e.target.value })}
            className={inputCls}
          />
        </label>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-slate-500">Теги (через запятую)</span>
        <input
          value={values.tags}
          onChange={(e) => set({ tags: e.target.value })}
          placeholder="infra, home"
          className={inputCls}
        />
      </label>
    </div>
  );
}

export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}
