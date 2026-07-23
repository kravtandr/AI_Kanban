import { useDraggable } from "@dnd-kit/core";
import { formatDue, isOverdue } from "../lib/dates";
import { PRIORITIES, type Project, type Task } from "../types";

interface ViewProps {
  task: Task;
  project: Project | undefined;
  overlay?: boolean;
}

/** Pure card markup — reused by the board card and the DragOverlay copy. */
export function TaskCardView({ task, project, overlay = false }: ViewProps) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!;
  const overdue = isOverdue(task.due_date, task.status);

  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900 ${
        overlay ? "rotate-2 shadow-xl ring-2 ring-sky-400/60" : "transition-shadow hover:shadow-md"
      }`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="text-sm font-medium leading-snug">{task.title}</span>
        {(task.source === "ai" || task.source === "mcp") && (
          <span
            title={task.source === "ai" ? "Создано с помощью AI" : "Создано агентом через MCP"}
            className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700"
          >
            {task.source === "ai" ? "AI" : "MCP"}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {project && (
          <span
            className="rounded-full px-2 py-0.5 font-medium text-white"
            style={{ backgroundColor: project.color }}
          >
            {project.name}
          </span>
        )}
        <span className={`rounded-full px-2 py-0.5 font-medium ${priority.badge}`}>
          {priority.title}
        </span>
        {task.due_date && (
          <span
            className={`rounded-full px-2 py-0.5 ${
              overdue ? "bg-red-600 font-semibold text-white" : "bg-slate-100 text-slate-600"
            }`}
          >
            {formatDue(task.due_date)}
          </span>
        )}
        {task.tags.map((tag) => (
          <span key={tag} className="text-slate-400">
            #{tag}
          </span>
        ))}
      </div>
    </div>
  );
}

interface Props {
  task: Task;
  project: Project | undefined;
  onOpen: (task: Task) => void;
}

export default function TaskCard({ task, project, onOpen }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
  });

  // While dragging, the original stays in place dimmed; the moving copy is
  // rendered by DragOverlay at the top layer (never clipped by columns).
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task)}
      className={`cursor-grab touch-manipulation select-none ${isDragging ? "opacity-30" : ""}`}
    >
      <TaskCardView task={task} project={project} />
    </div>
  );
}
