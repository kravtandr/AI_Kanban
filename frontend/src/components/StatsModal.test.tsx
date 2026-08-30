import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Analytics, Task } from "../types";
import StatsModal from "./StatsModal";

const EMPTY: Analytics = {
  coverage: {
    as_of: "2026-08-30T09:15:00",
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

const FULL: Analytics = {
  ...EMPTY,
  coverage: { ...EMPTY.coverage, seeded_tasks: 39, untracked_tasks: 3, corpus_size: 7 },
  board_factor: 1.6,
  closed_minutes: 300,
  deleted_minutes: 45,
  inversions: ["L"],
  buckets: [
    { bucket: "XS", minutes: 15, seed_minutes: 15, observed_minutes: null, samples: 2, calibrated: false },
    { bucket: "S", minutes: 60, seed_minutes: 45, observed_minutes: 60, samples: 7, calibrated: true },
  ],
  projects: [
    {
      project_id: 2,
      project: "Сварог",
      color: "#38bdf8",
      closed_minutes: 300,
      open_minutes: 20,
      factor: 2.8,
      relative: 1.7,
      samples: 6,
    },
  ],
  stuck: [{ task_id: 42, title: "Починить бэкап", status: "todo", days: 18.4, spells: 3 }],
  running: [
    {
      task_id: 51,
      title: "Сделать UI",
      open_seconds: 8040,
      closed_seconds: 2700,
      predicted_minutes: 45,
      over: 2.98,
    },
  ],
};

/** Отдельный набор с НЕНУЛЕВЫМ открытым временем на доске. FULL для этого не
 * годится: там open_minutes = 0, и подмешивание его в знаменатель ничего не
 * меняет арифметически (300 + 0 == 300) — нарушение осталось бы невидимым.
 * Суммы проектов сходятся с досочными по обоим полям, как на бэкенде. */
const WITH_OPEN: Analytics = {
  ...EMPTY,
  closed_minutes: 300,
  open_minutes: 100,
  projects: [
    {
      project_id: 3,
      project: "Пасека",
      color: "#f472b6",
      closed_minutes: 300,
      open_minutes: 100,
      factor: null,
      relative: null,
      samples: 4,
    },
  ],
};

const TASKS: Task[] = [
  {
    id: 9,
    project_id: 2,
    title: "Дописать тесты",
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
    estimate: "S",
  },
];

function renderModal(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function open(tasks: Task[] = TASKS) {
  return renderModal(
    <StatsModal tasks={tasks} budgetHours={4} onBudgetChange={vi.fn()} onClose={vi.fn()} />,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** Точка ожидания — ВСЕГДА содержимое, которого нет до ответа запроса, и
 * никогда `findByRole("region", …)`.
 *
 * Блоки рисуют скелет с «—» с первого кадра и не исчезают (это требование, а
 * не случайность), поэтому сама секция в DOM есть ещё до того, как запрос
 * ушёл: `findByRole` на ней срабатывает на первой же синхронной проверке, и
 * следующий синхронный assert читает скелет вместо данных. Плюс useQuery
 * доносит данные на несколько микротасков позже, чем резолвится сам мок.
 * Ждать регион — значит не ждать ничего. */
describe("StatsModal", () => {
  it("баннер холодного старта считает untracked_tasks, а не seeded_tasks", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    open();

    const banner = await screen.findByRole("status");
    // Точное совпадение по узлу, а не toHaveTextContent: подстрока "3"
    // нашлась бы и внутри "39", то есть проверка не отличала бы
    // untracked_tasks от seeded_tasks — ровно то, что тест обязан ловить.
    expect(within(banner).getByText("3")).toBeInTheDocument();
    expect(banner).toHaveTextContent(/не попадут в калибровку/i);
    // Вторая строка — тише и мельче, и это ДРУГОЕ число: 39 − 3
    expect(within(banner).getByText(/ещё 36 задач/)).toBeInTheDocument();
  });

  it("без отсечённых задач баннера нет вовсе", async () => {
    // Досок с seeded_tasks=0 почти не бывает: важен случай, когда старые
    // задачи ЕСТЬ, но ни одна не отсечена. Он и отличает условие показа по
    // untracked_tasks от ошибочного показа по seeded_tasks.
    vi.spyOn(api, "analytics").mockResolvedValue({
      ...EMPTY,
      coverage: { ...EMPTY.coverage, seeded_tasks: 39, untracked_tasks: 0 },
    });
    open();

    // Подпись as_of есть только когда данные пришли: без этого ожидания
    // проверка «баннера нет» прошла бы ещё до ответа и не значила бы ничего.
    await screen.findByText(/данные на/);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("некалиброванный бакет объясняет себя, а не показывает выдуманное число", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    open();

    await screen.findByText(/по факту 60м/);
    const table = screen.getByRole("region", { name: "Калибровка" });
    expect(within(table).getByText(/мало данных \(n=2\)/)).toBeInTheDocument();
    expect(within(table).getByText(/по факту 60м/)).toBeInTheDocument();
  });

  it("подпись периода стоит над «куда ушло время» и НЕ над калибровкой", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    open();

    const spent = await screen.findByRole("region", { name: "Куда ушло время" });
    const calibration = screen.getByRole("region", { name: "Калибровка" });
    expect(within(spent).getByText(/за 30 дней/)).toBeInTheDocument();
    expect(within(calibration).queryByText(/за 30 дней/)).toBeNull();
  });

  it("удалённые минуты идут отдельной строкой, вне процентов", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    open();

    await screen.findByText(/по удалённым задачам/i);
    const spent = screen.getByRole("region", { name: "Куда ушло время" });
    expect(within(spent).getByText(/по удалённым задачам/i)).toBeInTheDocument();
  });

  it("знаменатель процентов — closed_minutes, открытое время в него не подмешано", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(WITH_OPEN);
    open([]);

    await screen.findByText(/ещё идёт/);
    const spent = screen.getByRole("region", { name: "Куда ушло время" });

    // 300 закрытых из 300 закрытых — ровно 100%. Подмешать в знаменатель
    // 100 открытых, и то же самое число станет 75%: проверяем КОНКРЕТНУЮ
    // ширину, а не факт существования полосы, иначе подмена не видна.
    expect(within(spent).getByText(/· 100%/)).toBeInTheDocument();
    const widths = [...spent.querySelectorAll<HTMLElement>('div[style*="width"]')].map(
      (el) => el.style.width,
    );
    expect(widths[0]).toBe("100%");
    // Открытое время — отдельная штриховка в масштабе закрытых (100 из 300)
    // и отдельная подпись. Ни в одно число с закрытым оно не складывается.
    expect(widths[1]).toBe("33%");
    expect(within(spent).getByText(/ещё идёт: 1ч 40м/)).toBeInTheDocument();
  });

  it("работающая задача показывает открытое и прошлое время двумя числами", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    open();

    await screen.findByText(/Сделать UI/);
    const now = screen.getByRole("region", { name: "Сейчас в работе" });
    expect(now).toHaveTextContent("2ч 14м");
    expect(now).toHaveTextContent("(+45м ранее)");
    expect(now).not.toHaveTextContent("2ч 59м");
  });

  it("пустые данные рисуют скелет с прочерком, а не исчезающие блоки", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(EMPTY);
    open([]);

    // Ждём загруженное состояние: скелет обязан пережить приход пустых
    // данных, а не только показаться до ответа.
    await screen.findByText(/данные на/);
    for (const name of ["Калибровка", "Куда ушло время", "Где застревает", "Сейчас в работе", "План на сегодня"]) {
      const block = screen.getByRole("region", { name });
      expect(within(block).getAllByText("—").length).toBeGreaterThan(0);
    }
  });

  it("страница не вызывает LLM при загрузке, только по кнопке", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    const insights = vi.spyOn(api, "insights").mockResolvedValue({
      data: FULL,
      facts: "buckets: S=60",
      text: "Задачи S занимают вдвое дольше оценки.",
      ai_ok: true,
      ai_error: null,
    });
    open();

    // Ждём ПОЛНОСТЬЮ загруженную страницу: «LLM не вызывается при загрузке»
    // доказывает только проверка после того, как загрузка случилась.
    await screen.findByText(/по факту 60м/);
    expect(insights).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /объяснить/i }));

    expect(insights).toHaveBeenCalledWith(30);
    expect(await screen.findByText(/вдвое дольше оценки/)).toBeInTheDocument();
    expect(screen.getByText(/факты, которые видел ai/i)).toBeInTheDocument();
  });

  it("смена периода после «объяснить» сбрасывает старый ответ AI", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    vi.spyOn(api, "insights").mockResolvedValue({
      data: FULL,
      facts: "buckets: S=60",
      text: "Текст про 30 дней.",
      ai_ok: true,
      ai_error: null,
    });
    open();

    await screen.findByText(/по факту 60м/);
    await userEvent.click(screen.getByRole("button", { name: /объяснить/i }));
    expect(await screen.findByText(/текст про 30 дней/i)).toBeInTheDocument();

    // Меняем период на 7 дней: старый ответ AI описывал 30 и обязан исчезнуть,
    // а не остаться висеть рядом с блоками, которые уже пересчитались на 7.
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Период" }), "7");

    expect(screen.queryByText(/текст про 30 дней/i)).toBeNull();
  });

  it("план на сегодня набирается из уже загруженных задач, без запроса", async () => {
    vi.spyOn(api, "analytics").mockResolvedValue(FULL);
    open();

    await screen.findByText(/Дописать тесты/);
    const plan = screen.getByRole("region", { name: "План на сегодня" });
    expect(within(plan).getByText(/Дописать тесты/)).toBeInTheDocument();
  });
});
