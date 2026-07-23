import { useDroppable } from "@dnd-kit/core";
import type { Project, Status, Task } from "../types";
import TaskCard from "./TaskCard";

interface Props {
  id: Status;
  title: string;
  tasks: Task[];
  projects: Map<number, Project>;
  onOpen: (task: Task) => void;
  onAdd: (status: Status) => void;
}

export default function Column({ id, title, tasks, projects, onOpen, onAdd }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${id}` });

  return (
    <section
      ref={setNodeRef}
      className={`flex min-w-[85vw] snap-center flex-col rounded-xl border p-2 transition-colors md:min-w-0 md:flex-1 ${
        isOver ? "border-amber/60 bg-amber/5" : "border-edge/60 bg-panel/50"
      }`}
    >
      <header className="flex items-center justify-between px-2 py-1.5">
        <h2 className="font-mono text-[11px] font-medium tracking-[0.16em] text-dim uppercase">
          {title}
        </h2>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[11px] text-dim/80">{tasks.length}</span>
          <button
            onClick={() => onAdd(id)}
            aria-label={`Добавить задачу в ${title}`}
            title={`Добавить задачу в ${title}`}
            className="flex h-6 w-6 items-center justify-center rounded-md font-mono text-sm text-dim transition hover:bg-edge/50 hover:text-amber"
          >
            +
          </button>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-1">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            project={projects.get(task.project_id)}
            onOpen={onOpen}
          />
        ))}
        {tasks.length === 0 && (
          <button
            onClick={() => onAdd(id)}
            className="m-1 rounded-lg border border-dashed border-edge/70 p-4 text-center font-mono text-[11px] text-dim/60 transition hover:border-dim/60 hover:text-dim"
          >
            пусто — добавить
          </button>
        )}
      </div>
    </section>
  );
}
