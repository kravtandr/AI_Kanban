import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, RunningTask, Task } from "../types";
import TaskCard, { TaskCardView } from "./TaskCard";

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
  created_at: "2026-07-26T00:00:00",
  updated_at: "2026-07-26T00:00:00",
  completed_at: null,
  estimate: null,
};

const PROJECT: Project = {
  id: 2,
  name: "Сварог",
  color: "#38bdf8",
  description: "",
  is_inbox: false,
  archived_at: null,
  active_tasks: 1,
};

function Harness({
  onOpen,
  onContextMenu,
}: {
  onOpen: (task: Task) => void;
  onContextMenu: (task: Task, at: { x: number; y: number }) => void;
}) {
  const guard = useRef(false);
  return (
    <TaskCard
      task={TASK}
      project={PROJECT}
      running={null}
      sinceFetchSeconds={0}
      onOpen={onOpen}
      onContextMenu={onContextMenu}
      clickGuard={guard}
    />
  );
}

describe("TaskCard", () => {
  it("по contextmenu отдаёт задачу и координаты, не открывая модалку", async () => {
    const onOpen = vi.fn();
    const onContextMenu = vi.fn();
    render(<Harness onOpen={onOpen} onContextMenu={onContextMenu} />);

    // Один обработчик contextmenu покрывает правый клик, долгое нажатие на
    // мобильном и клавиши Menu / Shift+F10.
    await userEvent.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("Сделать UI"),
    });

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].id).toBe(7);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("обычный клик по-прежнему открывает задачу", async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} onContextMenu={vi.fn()} />);
    await userEvent.click(screen.getByText("Сделать UI"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("не открывает модалку, если браузер прислал click вслед за contextmenu", async () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} onContextMenu={vi.fn()} />);
    const card = screen.getByText("Сделать UI");

    // Часть браузеров по долгому нажатию шлёт оба события. Без гашения
    // пользователь получил бы модалку задачи под открытым меню.
    await userEvent.pointer({ keys: "[MouseRight]", target: card });
    await userEvent.click(card);

    expect(onOpen).not.toHaveBeenCalled();
  });
});

/** iOS Safari не шлёт contextmenu по долгому нажатию — там его нет как
 * события. Поэтому жест распознаём сами по pointer-событиям. */
describe("TaskCard: долгое нажатие пальцем", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const onOpen = vi.fn();
    const onContextMenu = vi.fn();
    render(<Harness onOpen={onOpen} onContextMenu={onContextMenu} />);
    return { onOpen, onContextMenu, card: screen.getByText("Сделать UI") };
  }

  it("открывает меню после удержания", () => {
    const { onContextMenu } = setup();
    const card = screen.getByRole("button");

    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 50, clientY: 60 });
    vi.advanceTimersByTime(600);

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onContextMenu.mock.calls[0][0].id).toBe(7);
    expect(onContextMenu.mock.calls[0][1]).toEqual({ x: 50, y: 60 });
  });

  it("не открывает, если палец сдвинулся — это перетаскивание, не удержание", () => {
    const { onContextMenu } = setup();
    const card = screen.getByRole("button");

    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 50, clientY: 60 });
    fireEvent.pointerMove(card, { pointerType: "touch", clientX: 50, clientY: 90 });
    vi.advanceTimersByTime(600);

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("не открывает, если палец убрали раньше — это обычный тап", () => {
    const { onContextMenu } = setup();
    const card = screen.getByRole("button");

    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 50, clientY: 60 });
    vi.advanceTimersByTime(200);
    fireEvent.pointerUp(card, { pointerType: "touch" });
    vi.advanceTimersByTime(600);

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("мышь таймером не обслуживается — у неё есть настоящий contextmenu", () => {
    const { onContextMenu } = setup();
    const card = screen.getByRole("button");

    fireEvent.pointerDown(card, { pointerType: "mouse", clientX: 50, clientY: 60 });
    vi.advanceTimersByTime(600);

    expect(onContextMenu).not.toHaveBeenCalled();
  });

  it("тап после сработавшего удержания не открывает модалку", () => {
    const { onOpen, onContextMenu } = setup();
    const card = screen.getByRole("button");

    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 50, clientY: 60 });
    vi.advanceTimersByTime(600);
    fireEvent.pointerUp(card, { pointerType: "touch" });
    fireEvent.click(card);

    expect(onContextMenu).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

/** Таймер карточки прогоняется в поясе с НЕНУЛЕВЫМ смещением: при TZ=UTC
 * (как в CI) ошибочный разбор наивной UTC-метки через new Date(...) дал бы
 * правильное число и остался бы невидимым навсегда (§13.7).
 *
 * Именно vi.stubEnv, а не голое `process.env.TZ = ...`: @types/node в
 * проекте нет и заводить его ради одной строки нельзя, поэтому имя process
 * не типизировано и присваивание роняет `tsc -b --noEmit`. Эффект тот же —
 * Node перечитывает TZ, смещение становится −180. Не «упрощать» обратно. */
vi.stubEnv("TZ", "Europe/Moscow");

describe("TaskCard: оценка и живой таймер", () => {
  const RUNNING: RunningTask = {
    task_id: 7,
    title: "Сделать UI",
    open_seconds: 4800, // 1ч 20м
    closed_seconds: 0,
    predicted_minutes: 120,
    over: 0.66,
  };

  it("тест бесполезен при нулевом смещении — пояс обязан быть сдвинут", () => {
    expect(new Date().getTimezoneOffset()).not.toBe(0);
  });

  it("не начатая задача с оценкой показывает тусклую букву бакета", () => {
    render(
      <TaskCardView task={{ ...TASK, estimate: "M" }} project={PROJECT} running={null} />,
    );

    expect(screen.getByText("M")).toBeInTheDocument();
    expect(screen.queryByText(/▶/)).toBeNull();
  });

  it("у задачи без оценки буквы нет вовсе", () => {
    render(<TaskCardView task={TASK} project={PROJECT} running={null} />);

    expect(screen.queryByTitle("Оценка трудозатрат")).toBeNull();
  });

  it("работающая задача показывает живые часы янтарём", () => {
    render(
      <TaskCardView
        task={{ ...TASK, status: "in_progress", estimate: "M" }}
        project={PROJECT}
        running={RUNNING}
        sinceFetchSeconds={0}
      />,
    );

    const timer = screen.getByTitle(/в работе/i);
    expect(timer).toHaveTextContent("1ч 20м");
    expect(timer.className).toContain("text-amber");
  });

  it("таймер идёт: секунды с момента ответа прибавляются к open_seconds", () => {
    render(
      <TaskCardView
        task={{ ...TASK, status: "in_progress", estimate: "M" }}
        project={PROJECT}
        running={RUNNING}
        sinceFetchSeconds={600}
      />,
    );

    expect(screen.getByTitle(/в работе/i)).toHaveTextContent("1ч 30м");
  });

  it("за порогом бакета таймер краснеет и дописывает саму оценку", () => {
    render(
      <TaskCardView
        task={{ ...TASK, status: "in_progress", estimate: "S" }}
        project={PROJECT}
        running={{ ...RUNNING, open_seconds: 11400, predicted_minutes: 90, over: 2.11 }}
        sinceFetchSeconds={0}
      />,
    );

    const timer = screen.getByTitle(/в работе/i);
    expect(timer).toHaveTextContent("3ч 10м");
    expect(timer).toHaveTextContent("/ ~1ч 30м");
    expect(timer.className).toContain("text-danger");
  });

  it("прошлые заходы идут отдельной подписью и к таймеру не прибавляются", () => {
    render(
      <TaskCardView
        task={{ ...TASK, status: "in_progress", estimate: "M" }}
        project={PROJECT}
        running={{ ...RUNNING, closed_seconds: 7200 }}
        sinceFetchSeconds={0}
      />,
    );

    const timer = screen.getByTitle(/в работе/i);
    expect(timer).toHaveTextContent("1ч 20м");
    expect(timer).toHaveTextContent("(+2ч ранее)");
    // 4800 + 7200 = 3ч 20м — числа, которого не должно существовать (R8)
    expect(timer).not.toHaveTextContent("3ч 20м");
  });

  it("coverage.as_of в арифметику не входит: месячная давность ничего не меняет", () => {
    // Карточка склеивается ровно так же, как в BoardPage: точка отсчёта —
    // dataUpdatedAt запроса, а не подпись из ответа. Наивный UTC, разобранный
    // new Date(...), дал бы на московском браузере +3ч и мгновенный danger.
    const render1 = render(
      <TaskCardView
        task={{ ...TASK, status: "in_progress", estimate: "M" }}
        project={PROJECT}
        running={RUNNING}
        sinceFetchSeconds={0}
      />,
    );
    const fresh = render1.container.textContent;
    cleanup();

    render(
      <TaskCardView
        task={{ ...TASK, status: "in_progress", estimate: "M" }}
        project={PROJECT}
        running={RUNNING}
        sinceFetchSeconds={0}
      />,
    );

    expect(fresh).toContain("1ч 20м");
    expect(document.body.textContent).toContain("1ч 20м");
  });
});
