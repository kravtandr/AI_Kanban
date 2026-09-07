import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Expense, ExpenseSummary } from "../types";
import ExpensesPage from "./ExpensesPage";

vi.mock("../lib/useDictation", () => ({
  useDictation: () => ({ supported: false, recording: false, error: null, start: () => {}, stop: () => {} }),
  appendTranscript: (a: string, b: string) => `${a} ${b}`,
}));

const REC: Expense = {
  id: 1, title: "Netflix", note: "", amount: 89900, status: "recurring", period: "month",
  anchor_date: "2026-01-15", active: true, purchased_at: null, tags: [], sort_order: 1,
  source: "manual", created_at: "2026-09-01T00:00:00", updated_at: "2026-09-01T00:00:00",
  next_charge: "2026-09-15",
};
const WANT: Expense = { ...REC, id: 2, title: "Монитор", status: "wanted", period: null,
  anchor_date: null, amount: 3500000, next_charge: null };
const PAUSED: Expense = { ...REC, id: 3, title: "Спортзал", active: false, next_charge: null };

const SUMMARY: ExpenseSummary = {
  monthly_recurring: 89900, upcoming: [], upcoming_total: 0, wanted_total: 3500000,
  bought_this_month: 0, currency: "RUB",
};

function renderPage(path = "/expenses") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ExpensesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ExpensesPage", () => {
  it("рисует три колонки, карточки по статусам и итоги", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([REC, WANT]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage();
    await waitFor(() => expect(screen.getByText("Netflix")).toBeInTheDocument());
    expect(screen.getByText("Монитор")).toBeInTheDocument();
    for (const title of ["Регулярные", "Хочу купить", "Куплено"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    const wantCard = screen.getByRole("button", { name: /Монитор/ });
    expect(within(wantCard).getByText("35 000 ₽")).toBeInTheDocument();
  });

  it("?inactive=1 запрашивает include_inactive и показывает паузу", async () => {
    const list = vi.spyOn(api, "expenses").mockResolvedValue([REC, PAUSED]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage("/expenses?inactive=1");
    await waitFor(() => expect(screen.getByText("Спортзал")).toBeInTheDocument());
    expect(list.mock.calls[0][0].get("include_inactive")).toBe("true");
    expect(screen.getByText("пауза")).toBeInTheDocument();
  });

  it("?expense=2 открывает модалку карточки", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([REC, WANT]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage("/expenses?expense=2");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByLabelText("Название")).toHaveValue("Монитор");
  });

  it("ошибка итогов не ломает колонки", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([WANT]);
    vi.spyOn(api, "expenseSummary").mockRejectedValue(new Error("boom"));
    renderPage();
    await waitFor(() => expect(screen.getByText("Монитор")).toBeInTheDocument());
    expect(screen.queryByText(/в месяц/)).toBeNull();
  });

  it("ошибка загрузки трат: мобильный ряд и колонки не рисуются, только сообщение", async () => {
    vi.spyOn(api, "expenses").mockRejectedValue(new Error("boom"));
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("Не удалось загрузить траты — обновите страницу")).toBeInTheDocument(),
    );
    // Мобильный ряд теперь вложен в тот же `!expensesQuery.isError` гейт, что и
    // DndContext (следствие фикса Finding 1) — при ошибке загрузки трат не
    // рисуется ни он (ни табы, ни кнопка добавления), ни сами колонки; это
    // ожидаемое поведение — перетаскивать всё равно нечего.
    expect(screen.queryByRole("button", { name: /^Хочу купить/ })).toBeNull();
    expect(screen.queryByLabelText("Добавить трату в выбранную колонку")).toBeNull();
  });

  it("настоящий drag через PointerSensor: мобильные табы заменяются drop-зонами", async () => {
    vi.spyOn(api, "expenses").mockResolvedValue([REC, WANT]);
    vi.spyOn(api, "expenseSummary").mockResolvedValue(SUMMARY);
    renderPage();
    await waitFor(() => expect(screen.getByText("Монитор")).toBeInTheDocument());

    // До перетаскивания: мобильный таб — настоящая <button> (getNodeText берёт
    // только прямые текстовые узлы, так что вложенный <span> со счётчиком ей не
    // мешает). div с точным текстом заголовка (то, что рисует MobileDropZone)
    // пока отсутствует — заголовок без счётчика сидит только в табе-<button>
    // и в десктопном <h2> (он остаётся в DOM в jsdom независимо от md:-классов).
    expect(screen.getByRole("button", { name: /^Хочу купить/ })).toBeInTheDocument();
    expect(screen.queryByText("Хочу купить", { selector: "div" })).toBeNull();

    // dnd-kit's PointerSensor активируется только когда nativeEvent.isPrimary
    // строго true (core.cjs.development.js: PointerSensor.activators[0].handler
    // делает `if (!event.isPrimary || event.button !== 0) return false;`).
    // Ни родной PointerEvent из jsdom 25.0.1, ни домашний PointerEventPolyfill
    // из test-setup.ts (сейчас не подключается вовсе, т.к. этот jsdom уже сам
    // определяет глобальный PointerEvent) не выставляют isPrimary ни при каком
    // способе диспатча — ни через `new PointerEvent(..., {isPrimary:true})`
    // напрямую, ни через testing-library fireEvent (оба варианта проверены
    // отдельно: в обоих `event.isPrimary === undefined`). Активировать реальный
    // сенсор в jsdom "из коробки" невозможно ни для одной карточки на странице.
    // Патчим ровно одно readonly-поле нативного события перед диспатчем, чтобы
    // прогнать настоящий PointerSensor и настоящий onDragStart — это восполняет
    // недостающую часть jsdom, а не подменяет логику приложения или дерева.
    const card = screen.getByRole("button", { name: /Монитор/ });
    function firePointer(type: string, clientY: number) {
      const event = new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId: 1, button: 0, clientX: 0, clientY,
      });
      Object.defineProperty(event, "isPrimary", { value: true });
      act(() => {
        card.dispatchEvent(event);
      });
    }
    firePointer("pointerdown", 0);
    firePointer("pointermove", 30); // activationConstraint.distance: 8 — превышаем порог

    // Таб исчез (мобильный ряд переключился на drop-зоны — activeExpense стал
    // не null), а MobileDropZone (голый <div>{title}</div>, без счётчика)
    // появился — теперь есть ровно один div с точным текстом заголовка.
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Хочу купить/ })).toBeNull());
    expect(screen.getByText("Хочу купить", { selector: "div" })).toBeInTheDocument();

    // Аккуратно завершаем drag, чтобы не оставлять висящие document-листенеры
    // сенсора между тестами.
    firePointer("pointerup", 30);
  });

  // ЧЕСТНАЯ ГРАНИЦА ДОКАЗАТЕЛЬСТВА: то, что выше, доказывает только цепочку
  // «сенсор активировался → onDragStart → activeExpense → мобильный ряд рисует
  // MobileDropZone вместо табов». Это ОБЩАЯ вёрстка-переключалка, она не зависит
  // от того, вложен ли мобильный ряд в <DndContext> — до фикса Finding 1 тот же
  // самый DOM-переход происходил бы точно так же, потому что переключателем
  // служит React-состояние ExpensesPage, а не регистрация droppable.
  // Сам баг — что зоны не регистрируются в dnd-kit (`useDroppable` читает
  // `dispatch: noop` из дефолтного InternalContext, когда вызван вне
  // провайдера) — здесь НЕ проверяется и не может быть честно проверен в jsdom:
  // и до, и после фикса `isOver` для любой droppable-зоны на странице (колонки,
  // карточки, мобильные зоны) остаётся false, потому что jsdom's getBoundingClientRect
  // всегда возвращает нулевой прямоугольник, а дефолтный алгоритм коллизий
  // dnd-kit (rectIntersection) при нулевой площади не находит пересечений ни с
  // чем — это и есть та самая «честная граница измерения прямоугольников»,
  // упомянутая в брифе. Доказательство того, что регистрация теперь проходит
  // (а не идёт в noop), опирается на чтение кода: `defaultInternalContext.dispatch
  // = noop` (core.cjs.development.js) плюс структурная проверка, что
  // <div className="mb-2 ... md:hidden"> теперь синтаксически является потомком
  // <DndContext>, а не его соседом — см. отчёт задачи.
});
