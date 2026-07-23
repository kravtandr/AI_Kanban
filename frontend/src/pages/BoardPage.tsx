import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import Column from "../components/Column";
import FilterBar, { type Filters } from "../components/FilterBar";
import NewTaskModal from "../components/NewTaskModal";
import QuickAdd from "../components/QuickAdd";
import { TaskCardView } from "../components/TaskCard";
import TaskModal from "../components/TaskModal";
import type { Priority, Status, Task } from "../types";
import { STATUSES } from "../types";

function filtersFromParams(params: URLSearchParams): Filters {
  return {
    projects: params.getAll("project").map(Number).filter(Boolean),
    priority: (params.get("priority") ?? "") as Priority | "",
    q: params.get("q") ?? "",
  };
}

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [createStatus, setCreateStatus] = useState<Status | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const queryClient = useQueryClient();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  const taskParams = new URLSearchParams();
  filters.projects.forEach((id) => taskParams.append("project_id", String(id)));
  if (filters.priority) taskParams.set("priority", filters.priority);
  if (filters.q) taskParams.set("q", filters.q);

  const tasksQuery = useQuery({
    queryKey: ["tasks", taskParams.toString()],
    queryFn: () => api.tasks(taskParams),
  });

  const moveMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: Status }) => api.moveTask(id, status),
    onMutate: async ({ id, status }) => {
      // Optimistic update with rollback on error (FR-4.2).
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      const snapshots = queryClient.getQueriesData<Task[]>({ queryKey: ["tasks"] });
      queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { snapshots };
    },
    onError: (_err, _vars, context) => {
      context?.snapshots.forEach(([key, data]) => queryClient.setQueryData(key, data));
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
  });

  function setFilters(next: Filters) {
    const params = new URLSearchParams();
    next.projects.forEach((id) => params.append("project", String(id)));
    if (next.priority) params.set("priority", next.priority);
    if (next.q) params.set("q", next.q);
    setSearchParams(params, { replace: true });
  }

  function onDragStart(event: DragStartEvent) {
    setActiveTask((event.active.data.current?.task as Task | undefined) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const task = event.active.data.current?.task as Task | undefined;
    const overId = event.over?.id;
    if (!task || typeof overId !== "string" || !overId.startsWith("column-")) return;
    const status = overId.replace("column-", "") as Status;
    if (status !== task.status) moveMutation.mutate({ id: task.id, status });
  }

  async function logout() {
    await api.logout();
    window.location.assign("/login");
  }

  const projects = projectsQuery.data ?? [];
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const tasks = tasksQuery.data ?? [];

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-3 border-b border-slate-200 bg-white/80 p-3 backdrop-blur md:px-5 dark:border-slate-800 dark:bg-slate-950/80">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-lg font-bold">TaskTracker</h1>
          <div className="flex flex-1 justify-center md:justify-end">
            <QuickAdd projects={projects} />
          </div>
          <button
            onClick={logout}
            className="hidden text-sm text-slate-400 hover:text-slate-600 md:block"
          >
            Выйти
          </button>
        </div>
        <FilterBar projects={projects} filters={filters} onChange={setFilters} />
      </header>

      <main className="flex-1 overflow-hidden p-3 md:p-4">
        {tasksQuery.isError ? (
          <p className="p-4 text-sm text-red-600">Не удалось загрузить задачи</p>
        ) : (
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
            <div className="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto md:snap-none">
              {STATUSES.map((column) => (
                <Column
                  key={column.id}
                  id={column.id}
                  title={column.title}
                  tasks={tasks.filter((t) => t.status === column.id)}
                  projects={projectMap}
                  onOpen={setOpenTask}
                  onAdd={setCreateStatus}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeTask && (
                <TaskCardView
                  task={activeTask}
                  project={projectMap.get(activeTask.project_id)}
                  overlay
                />
              )}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {openTask && (
        <TaskModal task={openTask} projects={projects} onClose={() => setOpenTask(null)} />
      )}
      {createStatus && (
        <NewTaskModal
          status={createStatus}
          projects={projects}
          onClose={() => setCreateStatus(null)}
        />
      )}
    </div>
  );
}
