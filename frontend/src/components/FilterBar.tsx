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
        placeholder="поиск…"
        className="input w-full py-1.5 font-mono text-xs md:w-48"
      />
      <select
        value={filters.priority}
        onChange={(e) => onChange({ ...filters, priority: e.target.value as Priority | "" })}
        className="input w-auto py-1.5 text-xs"
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
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] transition ${
                active ? "" : "border-edge text-dim hover:border-dim/60 hover:text-ink"
              }`}
              style={
                active
                  ? {
                      borderColor: project.color,
                      color: project.color,
                      backgroundColor: `${project.color}1f`,
                    }
                  : undefined
              }
            >
              <span style={{ color: project.color }}>●</span> {project.name}
              {project.active_tasks > 0 && ` · ${project.active_tasks}`}
            </button>
          );
        })}
      </div>
    </div>
  );
}
