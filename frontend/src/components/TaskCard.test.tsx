import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "../types";
import TaskCard from "./TaskCard";

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
