import type { Priority, Project } from "../types";
import { PRIORITIES } from "../types";

export interface Filters {
  projects: number[];
  priority: Priority | "";
  q: string;
}

export function activeFilterCount(filters: Filters): number {
  return filters.projects.length + (filters.priority ? 1 : 0) + (filters.q ? 1 : 0);
}

interface Props {
  projects: Project[];
  filters: Filters;
  onChange: (filters: Filters) => void;
  onLogout: () => void;
}

/** Содержимое сворачиваемой панели фильтров. Чипы проектов нейтральные:
 * цвет проекта остаётся только крошечной точкой-идентификатором,
 * активность отмечает янтарь — единственный акцент интерфейса. */
export default function FilterBar({ projects, filters, onChange, onLogout }: Props) {
  const toggleProject = (id: number) => {
    const next = filters.projects.includes(id)
      ? filters.projects.filter((p) => p !== id)
      : [...filters.projects, id];
    onChange({ ...filters, projects: next });
  };

  return (
    <div className="flex flex-col gap-2.5 md:flex-row md:flex-wrap md:items-center">
      <input
        type="search"
        name="q"
        autoComplete="off"
        spellCheck={false}
        aria-label="Поиск по задачам"
        value={filters.q}
        onChange={(e) => onChange({ ...filters, q: e.target.value })}
        placeholder="поиск…"
        className="input py-1.5 font-mono text-xs md:w-48"
      />
      <select
        name="priority"
        aria-label="Фильтр по приоритету"
        value={filters.priority}
        onChange={(e) => onChange({ ...filters, priority: e.target.value as Priority | "" })}
        className="input w-full py-1.5 text-xs md:w-auto"
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
              aria-pressed={active}
              title={project.name}
              className={`flex max-w-[14rem] items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] transition ${
                active
                  ? "border-amber/60 bg-amber/10 text-ink"
                  : "border-edge text-dim hover:border-dim/60 hover:text-ink active:bg-edge/40"
              }`}
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: project.color }}
              />
              <span className="truncate">{project.name}</span>
              {project.active_tasks > 0 && (
                <span className="shrink-0 text-dim/70">
                  <span className="sr-only">активных задач: </span>
                  {project.active_tasks}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <button
        onClick={onLogout}
        className="self-start py-1 font-mono text-xs text-dim transition hover:text-ink md:hidden"
      >
        выйти
      </button>
    </div>
  );
}
