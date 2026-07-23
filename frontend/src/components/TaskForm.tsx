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

export default function TaskForm({ values, projects, onChange, showStatus = false }: Props) {
  const set = (patch: Partial<TaskFormValues>) => onChange({ ...values, ...patch });

  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="eyebrow">Название</span>
        <input
          value={values.title}
          onChange={(e) => set({ title: e.target.value })}
          maxLength={200}
          required
          className="input"
        />
      </label>
      <label className="block">
        <span className="eyebrow">Описание · markdown</span>
        <textarea
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={5}
          className="input font-mono text-[13px]"
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow">Проект</span>
          <select
            value={values.project_id}
            onChange={(e) => set({ project_id: Number(e.target.value) })}
            className="input"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">Приоритет</span>
          <select
            value={values.priority}
            onChange={(e) => set({ priority: e.target.value as Priority })}
            className="input"
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
            <span className="eyebrow">Колонка</span>
            <select
              value={values.status}
              onChange={(e) => set({ status: e.target.value as Status })}
              className="input"
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
          <span className="eyebrow">Срок</span>
          <input
            type="date"
            value={values.due_date}
            onChange={(e) => set({ due_date: e.target.value })}
            className="input"
          />
        </label>
      </div>
      <label className="block">
        <span className="eyebrow">Теги · через запятую</span>
        <input
          value={values.tags}
          onChange={(e) => set({ tags: e.target.value })}
          placeholder="infra, home"
          className="input font-mono text-[13px]"
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
