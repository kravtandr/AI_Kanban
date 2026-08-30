import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Analytics, Project, RunningTask, Task } from "../types";
import BoardPage from "./BoardPage";

const PROJECT: Project = {
  id: 2,
  name: "Сварог",
  color: "#38bdf8",
  description: "",
  is_inbox: false,
  archived_at: null,
  active_tasks: 1,
};

const TASK: Task = {
  id: 7,
  project_id: 2,
  title: "Сделать UI",
  description: "",
  status: "todo",
  priority: "medium",
  tags: [],
  due_date: null,
  sort_order: 1,
  source: "manual",
  created_at: "2026-08-29T00:00:00",
  updated_at: "2026-08-29T00:00:00",
  completed_at: null,
  estimate: null,
};

const EMPTY_ANALYTICS: Analytics = {
  coverage: {
    as_of: "2026-08-29T09:00:00",
    window_days: 30,
    seeded_tasks: 0,
    untracked_tasks: 0,
    tracked_tasks: 0,
    drift_repaired: 0,
    capped_spells: 0,
    clock_anomalies: 0,
    corpus_size: 0,
  },
  board_factor: null,
  closed_minutes: 0,
  open_minutes: 0,
  deleted_minutes: 0,
  inversions: [],
  buckets: [],
  projects: [],
  stuck: [],
  running: [],
};

function runningAnalytics(taskId: number): Analytics {
  const running: RunningTask = {
    task_id: taskId,
    title: TASK.title,
    open_seconds: 120,
    closed_seconds: 0,
    predicted_minutes: null,
    over: null,
  };
  return { ...EMPTY_ANALYTICS, running: [running] };
}

function renderBoard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/"]}>
        <BoardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** The shared PointerEvent polyfill (test-setup.ts) doesn't set `isPrimary`,
 * and dnd-kit's PointerSensor activator bails out immediately on a falsy
 * `isPrimary` (`if (!event.isPrimary || event.button !== 0) return false`).
 * fireEvent.pointerDown alone can therefore never activate a drag under this
 * polyfill, so a real event object with isPrimary patched in is dispatched
 * directly. Each dispatch is wrapped in its own `act()`: dnd-kit's internal
 * sensor state (activation, then move tracking) is set via setState between
 * events, and an un-acted dispatchEvent lets the next event in the sequence
 * read stale internal state, silently dropping the drag before it starts.
 */
function firePointer(el: Element, type: string, init: PointerEventInit) {
  act(() => {
    const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
    Object.defineProperty(event, "isPrimary", { value: true });
    el.dispatchEvent(event);
  });
}

function makeRect(rect: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    top: 0,
    left: 0,
    right: 100,
    bottom: 100,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect;
}

/** dnd-kit's PointerSensor decides collisions from real layout rects, which
 * jsdom always reports as all-zero. Stubbing getBoundingClientRect per node
 * is the documented way to make a pointer-driven drag land on a specific
 * droppable in a jsdom test. */
function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(makeRect(rect));
}

/** BoardPage renders a <DragOverlay>: once a drag activates, dnd-kit measures
 * the OVERLAY's clone node instead of the original card
 * (core.esm.js: draggingNodeRect = dragOverlay.rect ?? activeNodeRect), and it
 * measures it the instant the clone mounts (a ref callback during the same
 * commit as the activating pointermove) -- too early for a per-node
 * `stubRect` call made after that event returns. Patching the prototype
 * before the drag starts covers the clone regardless of when it appears. */
function stubOverlayRectOnMount(rect: Partial<DOMRect>) {
  const proto = HTMLElement.prototype;
  vi.spyOn(proto, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains("ring-amber/50")) return makeRect(rect);
    return makeRect({});
  });
}

/** Перетаскивает карточку в колонку `columnHeading` через реальную
 * последовательность pointer-событий dnd-kit (activationConstraint
 * distance: 8), а не через прямой вызов onDragEnd — иначе тест доказывал бы
 * только то, что функция существует, а не что она подключена к настоящему
 * drag.
 *
 * BoardPage рендерит <DragOverlay>, и dnd-kit ПОСЛЕ его монтирования меряет
 * геометрию именно клона внутри оверлея (dragOverlay.rect), а не исходной
 * карточки (core.esm.js: `draggingNodeRect = dragOverlay.rect ?? activeNodeRect`)
 * -- оверлей монтируется только после активации drag, поэтому его rect
 * подменяется отдельным шагом, после первого движения.
 */
async function dragTaskToColumn(cardText: string, columnHeading: string) {
  const card = screen.getByText(cardText).closest('[role="button"]') as HTMLElement;
  stubRect(card, { top: 0, left: 0, bottom: 40, right: 200 });

  // Desktop column headers ("In Progress" etc.) are unique text; the mobile
  // tab strip uses the same STATUSES titles but as separate <button> tabs,
  // so scope to the <h2> to avoid ambiguity.
  const heading = screen.getByRole("heading", { name: columnHeading });
  const section = heading.closest("section") as HTMLElement;
  stubRect(section, { top: 500, left: 500, bottom: 900, right: 900 });
  // Covers the DragOverlay clone the instant it mounts (see helper doc above).
  stubOverlayRectOnMount({ top: 0, left: 0, bottom: 40, right: 200 });

  // dnd-kit's PointerSensor attaches move/end listeners on event.target itself
  // (getEventListenerTarget), not on document -- so every subsequent event of
  // this drag must fire on the SAME card node pointerdown fired on.
  firePointer(card, "pointerdown", { pointerId: 1, clientX: 20, clientY: 20, button: 0 });
  // Сдвиг больше activationConstraint.distance (8px): активирует перетаскивание
  // и монтирует DragOverlay.
  firePointer(card, "pointermove", { pointerId: 1, clientX: 20, clientY: 40 });
  firePointer(card, "pointermove", { pointerId: 1, clientX: 600, clientY: 600 });
  firePointer(card, "pointerup", { pointerId: 1, clientX: 600, clientY: 600 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("BoardPage: перетаскивание и живой таймер", () => {
  it("после перевода задачи в работу analytics инвалидируется и таймер появляется", async () => {
    vi.spyOn(api, "projects").mockResolvedValue([PROJECT]);
    vi.spyOn(api, "tasks").mockResolvedValue([TASK]);
    const analytics = vi
      .spyOn(api, "analytics")
      .mockResolvedValueOnce(EMPTY_ANALYTICS) // первый ответ: задача ещё не в работе
      .mockResolvedValue(runningAnalytics(TASK.id)); // после инвалидации: таймер идёт
    const moveTask = vi
      .spyOn(api, "moveTask")
      .mockResolvedValue({ ...TASK, status: "in_progress" });

    renderBoard();

    await screen.findByText("Сделать UI");
    // Аналитика уже пришла (пустая) — карточка пока без таймера.
    await waitFor(() => expect(analytics).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/▶/)).toBeNull();

    await dragTaskToColumn("Сделать UI", "In Progress");

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith(TASK.id, "in_progress"));

    // Находка №1: ни одна мутация раньше не инвалидировала ["analytics"], и
    // таймер не появлялся, пока вкладка остаётся в фокусе. Второй вызов
    // api.analytics — прямое доказательство инвалидации, а не просто
    // истечения staleTime (30с), которое само по себе refetch не запускает.
    await waitFor(() => expect(analytics).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/▶/)).toBeInTheDocument();
  });

  it("после перевода работающей задачи в Done таймер не остаётся висеть", async () => {
    const RUNNING_TASK: Task = { ...TASK, status: "in_progress" };
    vi.spyOn(api, "projects").mockResolvedValue([PROJECT]);
    vi.spyOn(api, "tasks").mockResolvedValue([RUNNING_TASK]);
    const analytics = vi
      .spyOn(api, "analytics")
      .mockResolvedValueOnce(runningAnalytics(RUNNING_TASK.id)) // задача ещё тикает
      .mockResolvedValue(EMPTY_ANALYTICS); // после инвалидации: заход закрыт, running пуст
    const moveTask = vi.spyOn(api, "moveTask").mockResolvedValue({ ...RUNNING_TASK, status: "done" });

    renderBoard();

    await screen.findByText("Сделать UI");
    await waitFor(() => expect(analytics).toHaveBeenCalledTimes(1));
    // Таймер тикает, пока задача в работе.
    expect(await screen.findByText(/▶/)).toBeInTheDocument();

    await dragTaskToColumn("Сделать UI", "Done");

    await waitFor(() => expect(moveTask).toHaveBeenCalledWith(TASK.id, "done"));

    // Без инвалидации analytics устаревший RunningTask остался бы в карте, и
    // карточка в Done продолжала бы показывать «▶ …» с растущим
    // sinceFetchSeconds — ровно вторая половина находки №1.
    await waitFor(() => expect(analytics).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/▶/)).toBeNull());
  });
});
