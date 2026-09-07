import {
  DndContext, DragOverlay, MeasuringStrategy, PointerSensor, useDroppable, useSensor, useSensors,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { ExpenseCardView } from "../components/ExpenseCard";
import ExpenseColumn from "../components/ExpenseColumn";
import ExpenseModal from "../components/ExpenseModal";
import ExpenseQuickAdd from "../components/ExpenseQuickAdd";
import ExpenseSummaryBar from "../components/ExpenseSummaryBar";
import NavTabs from "../components/NavTabs";
import NewExpenseModal from "../components/NewExpenseModal";
import { canDropTo, parseDropTarget } from "../lib/expenseDnd";
import { invalidateExpenses } from "../lib/invalidateExpenses";
import type { Expense, ExpenseStatus } from "../types";
import { EXPENSE_COLUMNS } from "../types";

const MOVE_KEY = ["move-expense"];

function MobileDropZone({ status, title, enabled }: { status: ExpenseStatus; title: string; enabled: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `mobiledrop-${status}`, disabled: !enabled });
  return (
    <div
      ref={setNodeRef}
      className={`tab flex-1 border border-dashed text-center transition-colors ${
        !enabled ? "border-edge/40 text-dim/40" : isOver ? "border-amber bg-amber/10 text-ink" : "border-edge text-dim"
      }`}
    >
      {title}
    </div>
  );
}

export default function ExpensesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeExpense, setActiveExpense] = useState<Expense | null>(null);
  const [createStatus, setCreateStatus] = useState<ExpenseStatus | null>(null);
  const suppressCardClick = useRef(false);
  const queryClient = useQueryClient();

  const updateParams = (mutate: (p: URLSearchParams) => void, replace = true) => {
    const params = new URLSearchParams(searchParams);
    mutate(params);
    setSearchParams(params, { replace });
  };

  const tag = searchParams.get("tag") ?? "";
  const q = searchParams.get("q") ?? "";
  const showInactive = searchParams.get("inactive") === "1";
  const mobileStatus: ExpenseStatus =
    EXPENSE_COLUMNS.find((c) => c.id === searchParams.get("col"))?.id ?? "recurring";
  const setMobileStatus = (s: ExpenseStatus) => updateParams((p) => p.set("col", s));
  const openExpense = (e: Expense) => updateParams((p) => p.set("expense", String(e.id)), false);
  const closeExpense = () => updateParams((p) => p.delete("expense"));

  const [debouncedQ, setDebouncedQ] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams();
  if (tag) params.set("tag", tag);
  if (debouncedQ) params.set("q", debouncedQ);
  if (showInactive) params.set("include_inactive", "true");

  const expensesQuery = useQuery({
    queryKey: ["expenses", params.toString()],
    queryFn: () => api.expenses(params),
    placeholderData: keepPreviousData,
  });
  const summaryQuery = useQuery({ queryKey: ["expenses-summary"], queryFn: api.expenseSummary, staleTime: 30_000 });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const moveMutation = useMutation({
    mutationKey: MOVE_KEY,
    mutationFn: ({ id, status, sortOrder }: { id: number; status: ExpenseStatus; sortOrder?: number }) =>
      api.moveExpense(id, status, sortOrder),
    onMutate: async ({ id, status, sortOrder }) => {
      await queryClient.cancelQueries({ queryKey: ["expenses"] });
      let prev: Expense | undefined;
      for (const [, data] of queryClient.getQueriesData<Expense[]>({ queryKey: ["expenses"] })) {
        prev = data?.find((e) => e.id === id) ?? prev;
      }
      queryClient.setQueriesData<Expense[]>({ queryKey: ["expenses"] }, (old) =>
        old?.map((e) => (e.id === id ? { ...e, status, sort_order: sortOrder ?? e.sort_order } : e)),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.prev) return;
      const prev = ctx.prev;
      queryClient.setQueriesData<Expense[]>({ queryKey: ["expenses"] }, (old) =>
        old?.map((e) => (e.id === prev.id ? prev : e)),
      );
    },
    onSettled: () => {
      if (queryClient.isMutating({ mutationKey: MOVE_KEY }) === 1) invalidateExpenses(queryClient);
    },
  });

  function onDragStart(event: DragStartEvent) {
    suppressCardClick.current = true;
    setActiveExpense((event.active.data.current?.expense as Expense | undefined) ?? null);
  }
  function releaseCardClick() {
    setTimeout(() => {
      suppressCardClick.current = false;
    }, 0);
  }
  function onDragEnd(event: DragEndEvent) {
    setActiveExpense(null);
    releaseCardClick();
    const expense = event.active.data.current?.expense as Expense | undefined;
    const target = parseDropTarget(event.over?.id);
    if (!expense || !target || !canDropTo(expense, target.status)) return;
    if (target.beforeId === expense.id) return;
    const before = target.beforeId ? expenses.find((e) => e.id === target.beforeId) : undefined;
    const sortOrder = before ? before.sort_order : undefined;
    if (target.status !== expense.status || sortOrder !== undefined) {
      moveMutation.mutate({ id: expense.id, status: target.status, sortOrder });
    }
    if (typeof event.over?.id === "string" && event.over.id.startsWith("mobiledrop-")) {
      setMobileStatus(target.status);
    }
  }

  async function logout() {
    try {
      await api.logout();
    } catch {
      // сервер проверит сессию сам
    } finally {
      window.location.assign("/login");
    }
  }

  const expenses = expensesQuery.data ?? [];
  const byStatus = (s: ExpenseStatus) =>
    expenses.filter((e) => e.status === s).sort((a, b) => a.sort_order - b.sort_order || b.id - a.id);
  const openId = Number(searchParams.get("expense")) || null;
  const open = openId ? (expenses.find((e) => e.id === openId) ?? null) : null;

  const updatedAt = expensesQuery.dataUpdatedAt;
  useEffect(() => {
    if (!openId || expensesQuery.isPending) return;
    if (expensesQuery.data?.some((e) => e.id === openId)) return;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("expense");
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, expensesQuery.isPending, updatedAt, setSearchParams]);

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-edge/70 bg-surface">
        <div className="flex items-center gap-3 p-3 md:px-5">
          <h1 className="shrink-0 font-mono text-base font-medium">
            <span className="caret">tasktracker</span>
          </h1>
          <NavTabs />
          <div className="flex flex-1 justify-end md:justify-center">
            <ExpenseQuickAdd />
          </div>
          <button onClick={logout} className="hidden shrink-0 font-mono text-xs text-dim transition hover:text-ink md:block">
            выйти
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-edge/50 p-3 md:px-5">
          <input
            value={q}
            onChange={(e) => updateParams((p) => (e.target.value ? p.set("q", e.target.value) : p.delete("q")))}
            placeholder="поиск"
            aria-label="Поиск по тратам"
            className="input max-w-xs"
          />
          <input
            value={tag}
            onChange={(e) => updateParams((p) => (e.target.value ? p.set("tag", e.target.value) : p.delete("tag")))}
            placeholder="тег"
            aria-label="Фильтр по тегу"
            className="input max-w-[10rem]"
          />
          <label className="flex items-center gap-2 font-mono text-xs text-dim">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => updateParams((p) => (e.target.checked ? p.set("inactive", "1") : p.delete("inactive")))}
            />
            показать паузу
          </label>
        </div>
      </header>

      <main className="flex flex-1 flex-col overflow-hidden p-3 md:p-4">
        {summaryQuery.data && <ExpenseSummaryBar summary={summaryQuery.data} />}

        <div className="mb-2 flex items-center gap-1 md:hidden">
          {activeExpense ? (
            EXPENSE_COLUMNS.map((c) => (
              <MobileDropZone key={c.id} status={c.id} title={c.title} enabled={canDropTo(activeExpense, c.id)} />
            ))
          ) : (
            <>
              <div className="no-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
                {EXPENSE_COLUMNS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setMobileStatus(c.id)}
                    aria-pressed={c.id === mobileStatus}
                    className={`tab ${c.id === mobileStatus ? "bg-panel text-ink" : "text-dim"}`}
                  >
                    {c.title}
                    <span className="ml-1.5 text-dim/60">{byStatus(c.id).length}</span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => setCreateStatus(mobileStatus)}
                aria-label="Добавить трату в выбранную колонку"
                className="btn-icon h-8 w-8 font-mono text-base"
              >
                <span aria-hidden="true">+</span>
              </button>
            </>
          )}
        </div>

        {expensesQuery.isError && (
          <p className="p-4 text-sm text-danger">Не удалось загрузить траты — обновите страницу</p>
        )}
        {!expensesQuery.isError && (
          <DndContext
            sensors={sensors}
            measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => {
              setActiveExpense(null);
              releaseCardClick();
            }}
          >
            <div className="flex flex-1 gap-3 overflow-hidden">
              {EXPENSE_COLUMNS.map((c) => (
                <ExpenseColumn
                  key={c.id}
                  id={c.id}
                  title={c.title}
                  expenses={byStatus(c.id)}
                  onOpen={openExpense}
                  onAdd={setCreateStatus}
                  activeOnMobile={c.id === mobileStatus}
                  canDrop={activeExpense ? canDropTo(activeExpense, c.id) : true}
                  clickGuard={suppressCardClick}
                />
              ))}
            </div>
            <DragOverlay dropAnimation={null}>
              {activeExpense && <ExpenseCardView expense={activeExpense} overlay />}
            </DragOverlay>
          </DndContext>
        )}
      </main>

      {open && <ExpenseModal key={open.id} expense={open} onClose={closeExpense} />}
      {createStatus && <NewExpenseModal status={createStatus} onClose={() => setCreateStatus(null)} />}
    </div>
  );
}
