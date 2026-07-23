import { useDroppable } from "@dnd-kit/core";
import type { Project, Status, Task } from "../types";
import TaskCard from "./TaskCard";

interface Props {
  id: Status;
  title: string;
  tasks: Task[];
  projects: Map<number, Project>;
  onOpen: (task: Task) => void;
}

export default function Column({ id, title, tasks, projects, onOpen }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: `column-${id}` });

  return (
    <section
      ref={setNodeRef}
      className={`flex min-w-[85vw] snap-center flex-col rounded-2xl p-2 md:min-w-0 md:flex-1 ${
        isOver ? "bg-sky-100/70 dark:bg-sky-950/40" : "bg-slate-200/60 dark:bg-slate-900/60"
      }`}
    >
      <header className="flex items-center justify-between px-2 py-1.5">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
        <span className="rounded-full bg-slate-300/70 px-2 text-xs font-medium text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          {tasks.length}
        </span>
      </header>
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-1">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} project={projects.get(task.project_id)} onOpen={onOpen} />
        ))}
      </div>
    </section>
  );
}
