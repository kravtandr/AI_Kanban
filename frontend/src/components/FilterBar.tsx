import type { Priority, Project } from "../types";
import { PRIORITIES } from "../types";

export interface Filters {
  projects: number[];
  priority: Priority | "";
  q: string;
}

interface Props {
  projects: Project[];
  filters: Filters;
  onChange: (filters: Filters) => void;
}

export default function FilterBar({ projects, filters, onChange }: Props) {
  const toggleProject = (id: number) => {
    const next = filters.projects.includes(id)
      ? filters.projects.filter((p) => p !== id)
      : [...filters.projects, id];
    onChange({ ...filters, projects: next });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
        placeholder="Поиск…"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm md:w-52 dark:border-slate-700 dark:bg-slate-900"
      />
      <select
        value={filters.priority}
        onChange={(e) => onChange({ ...filters, priority: e.target.value as Priority | "" })}
        className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
      >
        <option value="">Любой приоритет</option>
        {PRIORITIES.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title}
          </option>
        ))}
      </select>
      <div className="flex flex-wrap gap-1.5">
        {projects.map((project) => {
          const active = filters.projects.includes(project.id);
          return (
            <button
              key={project.id}
              onClick={() => toggleProject(project.id)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                active
                  ? "border-transparent text-white"
                  : "border-slate-300 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              }`}
              style={active ? { backgroundColor: project.color } : undefined}
            >
              {project.name}
              {project.active_tasks > 0 && ` · ${project.active_tasks}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
