import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import Column from "../components/Column";
import FilterBar, { activeFilterCount, type Filters } from "../components/FilterBar";
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

const MOVE_MUTATION_KEY = ["move-task"];

/** Мобильная drop-зона статуса: невидимые колонки (display:none) не могут
 * принять карточку, поэтому на время перетаскивания табы статусов
 * превращаются в цели для сброса. */
function MobileDropZone({ status, title }: { status: Status; title: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `mobiledrop-${status}` });
  return (
    <div
      ref={setNodeRef}
      className={`tab flex-1 border border-dashed text-center transition-colors ${
        isOver ? "border-amber bg-amber/10 text-ink" : "border-edge text-dim"
      }`}
    >
      {title}
    </div>
  );
}

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [createStatus, setCreateStatus] = useState<Status | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileStatus, setMobileStatus] = useState<Status>("todo");
  const queryClient = useQueryClient();

  // После drag браузер шлёт click по исходной карточке — гасим его,
  // чтобы перетаскивание не открывало модалку задачи.
  const suppressCardClick = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  const projectsQuery = useQuery({ queryKey: ["projects"], queryFn: api.projects });

  // Поиск дебаунсим: запрос уходит не на каждый символ, само поле ввода
  // остаётся контролируемым без задержки.
  const [debouncedQ, setDebouncedQ] = useState(filters.q);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(timer);
  }, [filters.q]);

  const taskParams = new URLSearchParams();
  filters.projects.forEach((id) => taskParams.append("project_id", String(id)));
  if (filters.priority) taskParams.set("priority", filters.priority);
  if (debouncedQ) taskParams.set("q", debouncedQ);

  const tasksQuery = useQuery({
    queryKey: ["tasks", taskParams.toString()],
    queryFn: () => api.tasks(taskParams),
    // При смене фильтров показываем прошлый список вместо мигания пустой доски
    placeholderData: keepPreviousData,
  });

  const moveMutation = useMutation({
    mutationKey: MOVE_MUTATION_KEY,
    mutationFn: ({ id, status }: { id: number; status: Status }) => api.moveTask(id, status),
    onMutate: async ({ id, status }) => {
      // Optimistic update with rollback on error (FR-4.2).
      await queryClient.cancelQueries({ queryKey: ["tasks"] });
      // Запоминаем только прежний статус этой задачи: откат всего снапшота
      // затирал бы оптимистичные изменения других мутаций в полёте
      let prevStatus: Status | undefined;
      for (const [, data] of queryClient.getQueriesData<Task[]>({ queryKey: ["tasks"] })) {
        const found = data?.find((t) => t.id === id);
        if (found) {
          prevStatus = found.status;
          break;
        }
      }
      queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status } : t)),
      );
      return { id, prevStatus };
    },
    onError: (_err, _vars, context) => {
      if (!context || context.prevStatus === undefined) return;
      const { id, prevStatus } = context;
      queryClient.setQueriesData<Task[]>({ queryKey: ["tasks"] }, (old) =>
        old?.map((t) => (t.id === id ? { ...t, status: prevStatus } : t)),
      );
    },
    onSettled: () => {
      // Инвалидируем только когда эта мутация — последняя: иначе refetch
      // среди быстрых перетаскиваний вернёт устаревшее состояние
      if (queryClient.isMutating({ mutationKey: MOVE_MUTATION_KEY }) === 1) {
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
    },
  });

  function setFilters(next: Filters) {
    const params = new URLSearchParams();
    next.projects.forEach((id) => params.append("project", String(id)));
    if (next.priority) params.set("priority", next.priority);
    if (next.q) params.set("q", next.q);
    setSearchParams(params, { replace: true });
  }

  function onDragStart(event: DragStartEvent) {
    suppressCardClick.current = true;
    setActiveTask((event.active.data.current?.task as Task | undefined) ?? null);
  }

  function releaseCardClick() {
    // Даём «сквозному» click отработать вхолостую и только потом снимаем флаг
    setTimeout(() => {
      suppressCardClick.current = false;
    }, 0);
  }

  function onDragCancel() {
    setActiveTask(null);
    releaseCardClick();
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    releaseCardClick();
    const task = event.active.data.current?.task as Task | undefined;
    const overId = event.over?.id;
    if (
      !task ||
      typeof overId !== "string" ||
      !(overId.startsWith("column-") || overId.startsWith("mobiledrop-"))
    )
      return;
    const status = overId.replace(/^(column-|mobiledrop-)/, "") as Status;
    if (status !== task.status) moveMutation.mutate({ id: task.id, status });
    // Сброс на мобильный таб — переключаемся на него, чтобы было видно,
    // куда приземлилась карточка
    if (overId.startsWith("mobiledrop-")) setMobileStatus(status);
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // Бэкенд недоступен — всё равно уводим на логин, сессию проверит сервер
    } finally {
      window.location.assign("/login");
    }
  }

  const projects = projectsQuery.data ?? [];
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const tasks = tasksQuery.data ?? [];
  const countByStatus = new Map<Status, number>(
    STATUSES.map((s) => [s.id, tasks.filter((t) => t.status === s.id).length]),
  );
  const filterCount = activeFilterCount(filters);

  return (
    <div className="flex h-full flex-col">
      {/* Без backdrop-blur: fixed-строка ввода QuickAdd на мобильном не должна
        получить containing block от предка с backdrop-filter. */}
      <header className="border-b border-edge/70 bg-surface">
        <div className="flex items-center gap-3 p-3 md:px-5">
          <h1 className="shrink-0 font-mono text-base font-medium">
            <span className="caret">tasktracker</span>
          </h1>
          <div className="flex flex-1 justify-end md:justify-center">
            <QuickAdd projects={projects} />
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            aria-label="Фильтры"
            aria-expanded={showFilters}
            title="Фильтры"
            className={`btn-icon relative ${showFilters ? "bg-edge/40 text-ink" : ""}`}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 5h18l-7 8v5l-4 2v-7L3 5Z" />
            </svg>
            {filterCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 font-mono text-[10px] font-semibold text-night">
                {filterCount}
              </span>
            )}
          </button>
          <button
            onClick={logout}
            className="hidden shrink-0 font-mono text-xs text-dim transition hover:text-ink md:block"
          >
            выйти
          </button>
        </div>
        {showFilters && (
          <div className="border-t border-edge/50 p-3 md:px-5">
            <FilterBar
              projects={projects}
              filters={filters}
              onChange={setFilters}
              onLogout={logout}
            />
          </div>
        )}
      </header>

      <main className="flex flex-1 flex-col overflow-hidden p-3 md:p-4">
        {projectsQuery.isError && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            <span>
              Не удалось загрузить проекты
              {projectsQuery.error instanceof Error ? `: ${projectsQuery.error.message}` : ""} —
              создание задач приостановлено
            </span>
            <button
              onClick={() => projectsQuery.refetch()}
              className="rounded-md border border-danger/50 px-2.5 py-1 font-mono text-xs transition hover:bg-danger/15"
            >
              Повторить
            </button>
          </div>
        )}

        {/* Мобильный переключатель колонок: одна колонка на экран.
          Во время перетаскивания табы уступают место drop-зонам статусов. */}
        <div className="mb-2 flex items-center gap-1 md:hidden">
          {activeTask ? (
            STATUSES.map((s) => <MobileDropZone key={s.id} status={s.id} title={s.title} />)
          ) : (
            <>
          <div className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
            {STATUSES.map((s) => {
              const active = s.id === mobileStatus;
              const count = countByStatus.get(s.id) ?? 0;
              return (
                <button
                  key={s.id}
                  onClick={() => setMobileStatus(s.id)}
                  className={`tab ${active ? "bg-panel text-ink" : "text-dim"}`}
                >
                  {s.title}
                  {count > 0 && (
                    <span className={`ml-1.5 ${active ? "text-dim" : "text-dim/60"}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <button
            onClick={() => setCreateStatus(mobileStatus)}
            aria-label="Добавить задачу в выбранную колонку"
            className="btn-icon h-8 w-8 font-mono text-base"
          >
            +
          </button>
            </>
          )}
        </div>

        {tasksQuery.isError ? (
          <p className="p-4 text-sm text-danger">Не удалось загрузить задачи</p>
        ) : (
          <DndContext
            sensors={sensors}
            // Drop-зоны мобильных табов монтируются уже во время drag —
            // их прямоугольники надо измерять постоянно, а не раз на старте
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <div className="flex min-h-0 flex-1 gap-3 md:gap-4">
              {STATUSES.map((column) => (
                <Column
                  key={column.id}
                  id={column.id}
                  title={column.title}
                  tasks={tasks.filter((t) => t.status === column.id)}
                  projects={projectMap}
                  onOpen={setOpenTask}
                  onAdd={setCreateStatus}
                  activeOnMobile={column.id === mobileStatus}
                  clickGuard={suppressCardClick}
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
