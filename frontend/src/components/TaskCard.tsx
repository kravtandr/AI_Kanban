import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useEffect, useRef, type MutableRefObject } from "react";
import { formatDue, isOverdue } from "../lib/dates";
import { fmtDur } from "../lib/duration";
import { PRIORITIES, type Project, type RunningTask, type Task } from "../types";

interface ViewProps {
  task: Task;
  project: Project | undefined;
  overlay?: boolean;
  /** Замер текущего захода из GET /analytics; null — задача не в работе
   * либо аналитика недоступна (доска при этом работает полностью). */
  running?: RunningTask | null;
  /** Секунды, прошедшие с момента, когда пришёл ответ аналитики. Считает
   * доска: (now − dataUpdatedAt) / 1000. Обе величины — часы браузера,
   * поэтому расхождение часов с сервером в арифметику не течёт (§12.1). */
  sinceFetchSeconds?: number;
}

/** Pure card markup — reused by the board card and the DragOverlay copy.
 * Карточка молчалива: заголовок и одна строка меты. Проект — тег с
 * заливкой в цвете проекта, теги и служебные подписи живут в модалке. */
export function TaskCardView({
  task,
  project,
  overlay = false,
  running = null,
  sinceFetchSeconds = 0,
}: ViewProps) {
  const priority = PRIORITIES.find((p) => p.id === task.priority)!;
  const overdue = isOverdue(task.due_date, task.status);
  const showProject = project && !project.is_inbox;

  // Открытое и закрытое время не складываются НИКОГДА: таймер показывает
  // только текущий заход, прошлые заходы идут отдельной подписью (R8).
  const elapsed = running ? running.open_seconds + sinceFetchSeconds : null;
  const budgetSeconds = running?.predicted_minutes ? running.predicted_minutes * 60 : null;
  const over = elapsed !== null && budgetSeconds !== null && elapsed > budgetSeconds;
  const overSuffix = over && budgetSeconds !== null ? ` / ~${fmtDur(budgetSeconds)}` : "";

  const hasMeta = Boolean(priority.mark || task.due_date || showProject || task.estimate || running);

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
          {running ? (
            <span
              className={over ? "font-medium text-danger" : "text-amber"}
              title={
                budgetSeconds !== null
                  ? `В работе; оценка ~${fmtDur(budgetSeconds)}`
                  : "В работе"
              }
            >
              <span aria-hidden="true">▶</span> {fmtDur(elapsed)}
              {overSuffix}
              {running.closed_seconds > 0 && ` (+${fmtDur(running.closed_seconds)} ранее)`}
            </span>
          ) : (
            task.estimate && (
              <span className="text-dim/70" title="Оценка трудозатрат">
                {task.estimate}
              </span>
            )
          )}
        </p>
      )}
    </div>
  );
}

interface Props {
  task: Task;
  project: Project | undefined;
  running: RunningTask | null;
  sinceFetchSeconds: number;
  onOpen: (task: Task) => void;
  /** Вызов контекстного меню: правый клик, долгое нажатие или клавиша Menu. */
  onContextMenu: (task: Task, at: { x: number; y: number }) => void;
  /** Пока true — игнорируем click: после drag браузер шлёт «сквозной»
   * click по исходной карточке, он не должен открывать модалку. */
  clickGuard: MutableRefObject<boolean>;
}

/** Сколько миллисекунд после contextmenu игнорировать click по карточке. */
const CONTEXT_MENU_CLICK_GRACE_MS = 500;
/** Удержание, после которого считаем жест долгим нажатием. */
const LONG_PRESS_MS = 500;
/** Сдвиг, после которого жест — перетаскивание, а не удержание.
 * Совпадает с activationConstraint у PointerSensor в BoardPage: меню и drag
 * должны расходиться по одному и тому же порогу, иначе появится зазор, где
 * срабатывает и то и другое. */
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

export default function TaskCard({
  task,
  project,
  running,
  sinceFetchSeconds,
  onOpen,
  onContextMenu,
  clickGuard,
}: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `task-${task.id}`,
    data: { task },
  });
  const { setNodeRef: setDropRef } = useDroppable({ id: `task-${task.id}`, data: { task } });
  // Часть браузеров шлёт click вслед за contextmenu по долгому нажатию. Без
  // гашения пользователь получал бы модалку задачи под открытым меню.
  // Метка времени, а не флаг: зависший флаг съел бы следующий честный click.
  const contextMenuAt = useRef(0);
  // iOS Safari по долгому нажатию не шлёт contextmenu вообще — там этого
  // события нет. Поэтому на тач-устройствах распознаём жест сами.
  const longPress = useRef<{ timer: number; x: number; y: number } | null>(null);

  useEffect(() => () => { if (longPress.current) clearTimeout(longPress.current.timer); }, []);

  const cancelLongPress = () => {
    if (!longPress.current) return;
    clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  return (
    <div
      ref={(node) => { setNodeRef(node); setDropRef(node); }}
      {...listeners}
      {...attributes}
      onPointerDown={(e) => {
        // listeners от dnd-kit содержат свой onPointerDown, и объявленный
        // ниже проп его перекрывает. Вызываем вручную, иначе перетаскивание
        // перестанет запускаться.
        listeners?.onPointerDown?.(e);
        // Мышь обслуживает настоящий contextmenu — таймер ей не нужен.
        if (e.pointerType === "mouse") return;
        cancelLongPress();
        const { clientX: x, clientY: y } = e;
        longPress.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            longPress.current = null;
            contextMenuAt.current = Date.now();
            onContextMenu(task, { x, y });
          }, LONG_PRESS_MS),
        };
      }}
      onPointerMove={(e) => {
        const pressed = longPress.current;
        if (!pressed) return;
        if (Math.hypot(e.clientX - pressed.x, e.clientY - pressed.y) > LONG_PRESS_MOVE_TOLERANCE_PX)
          cancelLongPress();
      }}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClick={() => {
        if (clickGuard.current) return;
        if (Date.now() - contextMenuAt.current < CONTEXT_MENU_CLICK_GRACE_MS) return;
        onOpen(task);
      }}
      onContextMenu={(e) => {
        // Правый клик, клавиши Menu / Shift+F10 (клавиатурная доступность
        // достаётся бесплатно) и долгое нажатие в Chromium на Android.
        // iOS Safari сюда не приходит — его обслуживает таймер выше.
        e.preventDefault();
        cancelLongPress();
        contextMenuAt.current = Date.now();
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
      <TaskCardView
        task={task}
        project={project}
        running={running}
        sinceFetchSeconds={sinceFetchSeconds}
      />
    </div>
  );
}
