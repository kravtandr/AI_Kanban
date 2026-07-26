import { useDraggable } from "@dnd-kit/core";
import type { MutableRefObject } from "react";
import { formatDue, isOverdue } from "../lib/dates";
import { PRIORITIES, type Project, type Task } from "../types";

interface ViewProps {
  task: Task;
  project: Project | undefined;
  overlay?: boolean;
}

/** Pure card markup — reused by the board card and the DragOverlay copy.
 * Карточка молчалива: заголовок и одна строка меты. Проект — тег с
 * заливкой в цвете проекта, теги и служебные подписи живут в модалке. */
export function TaskCardView({ task, project, overlay = false }: ViewProps) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!;
  const overdue = isOverdue(task.due_date, task.status);
  const showProject = project && !project.is_inbox;
  const hasMeta = Boolean(priority.mark || task.due_date || showProject);

  return (
    <div
      className={`rounded-lg border bg-card px-3 py-2.5 ${
        overlay
          ? "rotate-1 border-edge shadow-2xl ring-2 ring-amber/50"
          : "border-edge/60 transition hover:border-dim/40"
      }`}
    >
      {/* break-words: заголовок может прийти от агента одной длинной строкой
        без пробелов (URL, идентификатор) и распёр бы карточку. */}
      <p className="text-[15px] leading-snug font-medium break-words md:text-sm">{task.title}</p>
      {hasMeta && (
        <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-dim">
          {showProject && (
            <span
              className="max-w-full truncate rounded-md px-1.5 py-px"
              style={{ color: project.color, backgroundColor: `${project.color}1f` }}
            >
              {project.name}
            </span>
          )}
          {priority.mark && (
            <span className={priority.cls} title={`Приоритет: ${priority.title}`}>
              {priority.mark} {priority.title.toLowerCase()}
            </span>
          )}
          {task.due_date && (
            <span
              className={overdue ? "font-medium text-danger" : ""}
              title={overdue ? "Просрочено" : "Срок"}
            >
              {formatDue(task.due_date)}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

interface Props {
  task: Task;
  project: Project | undefined;
  onOpen: (task: Task) => void;
  /** Вызов контекстного меню: правый клик, долгое нажатие или клавиша Menu. */
  onContextMenu: (task: Task, at: { x: number; y: number }) => void;
  /** Пока true — игнорируем click: после drag браузер шлёт «сквозной»
   * click по исходной карточке, он не должен открывать модалку. */
  clickGuard: MutableRefObject<boolean>;
}

export default function TaskCard({ task, project, onOpen, onContextMenu, clickGuard }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => {
        if (clickGuard.current) return;
        onOpen(task);
      }}
      onContextMenu={(e) => {
        // Один обработчик на три жеста: правый клик, долгое нажатие на
        // мобильном (Chromium и Safari шлют contextmenu) и клавиши
        // Menu / Shift+F10 — клавиатурная доступность достаётся бесплатно.
        e.preventDefault();
        onContextMenu(task, { x: e.clientX, y: e.clientY });
      }}
      onKeyDown={(e) => {
        // dnd-kit даёт карточке role=button и tabIndex, но Enter сам не обработает
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
        }
      }}
      // -webkit-touch-callout: иначе долгое нажатие в Safari поднимает
      // нативную выноску поверх нашего меню. select-none уже есть.
      className={`cursor-grab touch-manipulation select-none [-webkit-touch-callout:none] ${
        isDragging ? "opacity-30" : ""
      }`}
    >
      <TaskCardView task={task} project={project} />
    </div>
  );
}
