import { useDroppable } from "@dnd-kit/core";
import type { MutableRefObject } from "react";
import type { Project, Status, Task } from "../types";
import TaskCard from "./TaskCard";

interface Props {
  id: Status;
  title: string;
  tasks: Task[];
  projects: Map<number, Project>;
  onOpen: (task: Task) => void;
  onAdd: (status: Status) => void;
  /** На мобильном видна одна колонка — выбранная в табах статусов. */
  activeOnMobile: boolean;
  /** Пока true — карточки игнорируют click (гасит «сквозной» click после drag). */
  clickGuard: MutableRefObject<boolean>;
}

/** Колонка без коробки: заголовок-моно и стопка карточек, воздух вместо
 * рамок. Подсветка появляется только когда над колонкой тащат карточку. */
export default function Column({
  id,
  title,
  tasks,
  projects,
  onOpen,
  onAdd,
  activeOnMobile,
  clickGuard,
}: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${id}` });

  return (
    <section
      ref={setNodeRef}
      className={`${activeOnMobile ? "flex" : "hidden"} min-w-0 flex-1 flex-col rounded-xl transition-colors md:flex md:border md:p-1.5 ${
        isOver ? "bg-amber/5 md:border-amber/60" : "md:border-edge/60 md:bg-panel/40"
      }`}
    >
      <header className="hidden items-baseline gap-2 px-2 pt-1 pb-2 md:flex">
        <h2 className="font-mono text-[11px] font-medium tracking-[0.16em] text-dim uppercase">
          {title}
        </h2>
        <span className="font-mono text-[11px] text-dim/60">{tasks.length}</span>
        <button
          onClick={() => onAdd(id)}
          aria-label={`Добавить задачу в ${title}`}
          title={`Добавить задачу в ${title}`}
          className="ml-auto flex h-6 w-6 items-center justify-center rounded-md font-mono text-sm text-dim/70 transition hover:bg-edge/50 hover:text-amber"
        >
          +
        </button>
      </header>
      <div className="card-list flex flex-1 flex-col gap-2 overflow-y-auto overscroll-contain p-0.5 pb-28 md:pb-2">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            project={projects.get(task.project_id)}
            onOpen={onOpen}
            clickGuard={clickGuard}
          />
        ))}
        {tasks.length === 0 && (
          <button
            onClick={() => onAdd(id)}
            className="rounded-lg p-6 text-center font-mono text-xs text-dim/50 transition hover:text-dim"
          >
            пусто — добавить
          </button>
        )}
      </div>
    </section>
  );
}
