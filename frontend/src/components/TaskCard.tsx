import { useDraggable } from "@dnd-kit/core";
import { formatDue, isOverdue } from "../lib/dates";
import { PRIORITIES, type Project, type Task } from "../types";

interface ViewProps {
  task: Task;
  project: Project | undefined;
  overlay?: boolean;
}

const SOURCE_RAIL: Record<Task["source"], string> = {
  manual: "transparent", // человеческое — тихое
  ai: "var(--color-ai)",
  mcp: "var(--color-mcp)",
};

/** Pure card markup — reused by the board card and the DragOverlay copy. */
export function TaskCardView({ task, project, overlay = false }: ViewProps) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!;
  const overdue = isOverdue(task.due_date, task.status);

  return (
    <div
      className={`rounded-lg border border-edge bg-card p-3 ${
        overlay
          ? "rotate-1 shadow-2xl ring-2 ring-amber/50"
          : "transition hover:-translate-y-px hover:border-dim/50"
      }`}
      style={{ borderLeftWidth: 3, borderLeftColor: SOURCE_RAIL[task.source] }}
    >
      <p className="mb-1.5 text-sm leading-snug font-medium">{task.title}</p>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-dim">
        {priority.mark && (
          <span className={priority.cls} title={`Приоритет: ${priority.title}`}>
            {priority.mark}
          </span>
        )}
        {project && (
          <span>
            <span style={{ color: project.color }}>●</span> {project.name}
          </span>
        )}
        {task.due_date && (
          <span
            className={overdue ? "font-medium text-danger" : ""}
            title={overdue ? "Просрочено" : "Срок"}
          >
            {overdue ? "⚠ " : ""}
            {formatDue(task.due_date)}
          </span>
        )}
        {task.tags.map((tag) => (
          <span key={tag} className="text-dim/70">
            #{tag}
          </span>
        ))}
        {task.source === "ai" && (
          <span className="text-ai" title="Оформлено AI">
            ai
          </span>
        )}
        {task.source === "mcp" && (
          <span className="text-mcp" title="Создано агентом через MCP">
            mcp
          </span>
        )}
      </p>
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
