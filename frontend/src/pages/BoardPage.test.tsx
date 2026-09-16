import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("Промпт для кодового агента", () => {
  function setup(tasks = [TASK]) {
    vi.spyOn(api, "projects").mockResolvedValue([PROJECT]);
    vi.spyOn(api, "tasks").mockResolvedValue(tasks);
    vi.spyOn(api, "analytics").mockResolvedValue(EMPTY_ANALYTICS);
    renderBoard();
  }

  it("кнопка карточки генерирует промпт, не открывает задачу, позволяет копировать", async () => {
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      prompt: "Изучи репозиторий и реализуй UI.", ai_ok: true, ai_error: null,
    })));
    const taskRead = vi.spyOn(api, "task");
    setup();
    await user.click(await screen.findByRole("button", { name: "Промпт для задачи «Сделать UI»" }));
    expect(await screen.findByRole("dialog", { name: "Промпт для агента" })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Изучи репозиторий и реализуй UI.")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/api/v1/ai/agent-prompt/7", expect.objectContaining({ method: "POST" }));
    expect(taskRead).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Копировать" }));
    expect(await navigator.clipboard.readText()).toBe("Изучи репозиторий и реализуй UI.");
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("Скопировано");
    await user.click(screen.getByRole("button", { name: "Закрыть" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("ошибка AI позволяет повторить запрос; ожидание не запускает дубликаты", async () => {
    let finish!: (value: Response) => void;
    const fetch = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: null, ai_ok: false, ai_error: "LLM service unavailable" })))
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Промпт для задачи «Сделать UI»" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("AI недоступен");
    expect(screen.queryByRole("button", { name: "Копировать" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await within(screen.getByRole("dialog")).findByRole("status")).toHaveTextContent("Генерирую");
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    await act(async () => finish(new Response(JSON.stringify({ prompt: "Готовый промпт", ai_ok: true, ai_error: null }))));
    expect(await screen.findByDisplayValue("Готовый промпт")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("клавиатура на кнопке промпта не открывает карточку", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ prompt: "Промпт", ai_ok: true, ai_error: null })));
    const taskRead = vi.spyOn(api, "task");
    setup();
    (await screen.findByRole("button", { name: "Промпт для задачи «Сделать UI»" })).focus();
    await user.keyboard("{Enter}");
    expect(await screen.findByDisplayValue("Промпт")).toBeInTheDocument();
    expect(taskRead).not.toHaveBeenCalled();
  });

  it("если копирование запрещено, выделяет текст для ручного копирования", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("Permission denied"));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ prompt: "Промпт для копирования", ai_ok: true, ai_error: null })));
    setup();
    await user.click(await screen.findByRole("button", { name: "Промпт для задачи «Сделать UI»" }));
    const field = await screen.findByRole("textbox", { name: "Готовый промпт" }) as HTMLTextAreaElement;
    await user.click(screen.getByRole("button", { name: "Копировать" }));
    expect(await screen.findByText(/скопируйте его вручную/)).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it("показывает сетевую ошибку с повтором", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Промпт для задачи «Сделать UI»" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("проверьте соединение");
    expect(screen.getByRole("button", { name: "Повторить" })).toBeEnabled();
  });

  it("поздний ответ закрытой задачи не подменяет промпт другой задачи", async () => {
    let finishFirst!: (value: Response) => void;
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ prompt: "Промпт второй задачи", ai_ok: true, ai_error: null })));
    setup([TASK, { ...TASK, id: 8, title: "Вторая задача" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Промпт для задачи «Сделать UI»" }));
    await within(await screen.findByRole("dialog")).findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    fireEvent.click(screen.getByRole("button", { name: "Промпт для задачи «Вторая задача»" }));
    expect(await screen.findByDisplayValue("Промпт второй задачи")).toBeInTheDocument();
    await act(async () => finishFirst(new Response(JSON.stringify({ prompt: "Старый ответ", ai_ok: true, ai_error: null }))));
    expect(screen.queryByDisplayValue("Старый ответ")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("Промпт второй задачи")).toBeInTheDocument();
  });
});

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

describe("BoardPage: мобильный ряд колонок", () => {
  it("ошибка загрузки задач: мобильный ряд не рисуется вместе с колонками", async () => {
    vi.spyOn(api, "projects").mockResolvedValue([PROJECT]);
    vi.spyOn(api, "tasks").mockRejectedValue(new Error("boom"));
    vi.spyOn(api, "analytics").mockResolvedValue(EMPTY_ANALYTICS);

    renderBoard();

    await waitFor(() =>
      expect(
        screen.getByText("Не удалось загрузить задачи — проверьте соединение и обновите страницу"),
      ).toBeInTheDocument(),
    );

    // Мобильный ряд теперь вложен в тот же гейт `!tasksQuery.isError`, что и
    // <DndContext> (следствие переноса ряда внутрь контекста): при ошибке
    // загрузки не рисуется ни он — ни табы, ни кнопка добавления, — ни сами
    // колонки. Это осознанное изменение поведения: перетаскивать и
    // переключать всё равно нечего, задач нет.
    expect(screen.queryByRole("button", { name: /^Backlog/ })).toBeNull();
    expect(screen.queryByLabelText("Добавить задачу в выбранную колонку")).toBeNull();
  });

  it("настоящий drag через PointerSensor: мобильные табы заменяются drop-зонами", async () => {
    vi.spyOn(api, "projects").mockResolvedValue([PROJECT]);
    vi.spyOn(api, "tasks").mockResolvedValue([TASK]);
    vi.spyOn(api, "analytics").mockResolvedValue(EMPTY_ANALYTICS);

    renderBoard();
    await screen.findByText("Сделать UI");

    // До перетаскивания: мобильный таб — настоящая <button> (счётчик живёт во
    // вложенном <span>, якорь /^Backlog/ отсекает кнопку «Добавить задачу в
    // Backlog» из десктопной колонки). Голого <div> с точным текстом
    // заголовка — того, что рисует MobileDropZone, — пока нет: в десктопной
    // колонке заголовок сидит в <h2>.
    expect(screen.getByRole("button", { name: /^Backlog/ })).toBeInTheDocument();
    expect(screen.queryByText("Backlog", { selector: "div" })).toBeNull();

    const card = screen.getByText("Сделать UI").closest('[role="button"]') as HTMLElement;
    firePointer(card, "pointerdown", { pointerId: 1, clientX: 20, clientY: 20, button: 0 });
    // Сдвиг больше activationConstraint.distance (8px) — активирует drag.
    firePointer(card, "pointermove", { pointerId: 1, clientX: 20, clientY: 40 });

    await waitFor(() => expect(screen.queryByRole("button", { name: /^Backlog/ })).toBeNull());
    expect(screen.getByText("Backlog", { selector: "div" })).toBeInTheDocument();

    // Аккуратно завершаем drag, чтобы сенсор снял свои document-листенеры.
    firePointer(card, "pointerup", { pointerId: 1, clientX: 20, clientY: 40 });
  });

  // ЧЕСТНАЯ ГРАНИЦА ДОКАЗАТЕЛЬСТВА: тест выше проверяет только цепочку
  // «сенсор активировался → onDragStart → activeTask → мобильный ряд рисует
  // MobileDropZone вместо табов». Переключателем служит React-состояние
  // BoardPage, а не регистрация droppable, поэтому этот же переход происходил
  // и ДО переноса ряда внутрь <DndContext> — тест покрывает вёрстку ряда на
  // новом месте, но сам баг не различает.
  // Сам баг — что зоны не регистрировались в dnd-kit (`useDroppable` читает
  // `dispatch: noop` из дефолтного InternalContext, когда вызван вне
  // провайдера, core.cjs.development.js) — в jsdom честно проверить нельзя:
  // и до, и после переноса `isOver` у любой зоны остаётся false, потому что
  // jsdom's getBoundingClientRect отдаёт нулевой прямоугольник, а
  // rectIntersection при нулевой площади не находит пересечений (существующие
  // drag-тесты выше именно поэтому подменяют rect'ы вручную).
  // Доказательство того, что регистрация теперь идёт в реальный dispatch,
  // опирается на чтение кода плюс структурный факт, что ряд стал потомком
  // <DndContext>, а не его соседом.
});
