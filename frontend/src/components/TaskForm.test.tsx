import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

const onTextRef = vi.hoisted(() => ({ current: (_: string) => {} }));
const mockDictation = vi.hoisted(() => ({
  supported: true,
  state: "idle" as "idle" | "recording" | "transcribing",
  error: null as string | null,
  notice: null as string | null,
  seconds: 0,
  toggle: vi.fn(),
}));

vi.mock("../lib/useDictation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/useDictation")>();
  return {
    ...actual,
    useDictation: (onText: (text: string) => void) => {
      onTextRef.current = onText;
      return mockDictation;
    },
  };
});

const PROJECTS: Project[] = [
  {
    id: 1,
    name: "Inbox",
    color: "#6b7280",
    description: "",
    is_inbox: true,
    archived_at: null,
    active_tasks: 0,
  },
];

const VALUES: TaskFormValues = {
  title: "Задача",
  description: "",
  project_id: 1,
  status: "todo",
  priority: "medium",
  tags: "",
  due_date: "",
};

describe("TaskForm — диктовка описания", () => {
  beforeEach(() => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    mockDictation.notice = null;
    mockDictation.seconds = 0;
  });

  it("расшифровка дописывается в описание", async () => {
    const onChange = vi.fn();
    render(<TaskForm values={VALUES} projects={PROJECTS} onChange={onChange} />);

    onTextRef.current("проверить бэкапы");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: "проверить бэкапы" }),
    );
  });

  it("расшифровка не затирает уже набранное описание", () => {
    const onChange = vi.fn();
    render(
      <TaskForm
        values={{ ...VALUES, description: "Начало." }}
        projects={PROJECTS}
        onChange={onChange}
      />,
    );

    onTextRef.current("Продолжение.");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ description: "Начало. Продолжение." }),
    );
  });

  it("расшифровка после описания из одних пробелов не оставляет пробел в начале", () => {
    const onChange = vi.fn();
    render(
      <TaskForm
        values={{ ...VALUES, description: "   " }}
        projects={PROJECTS}
        onChange={onChange}
      />,
    );

    onTextRef.current("Текст.");

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ description: "Текст." }));
  });

  it("после ручного ввода описания диктовка дописывает поверх набранного текста", async () => {
    function ControlledTaskForm() {
      const [values, setValues] = useState(VALUES);
      return <TaskForm values={values} projects={PROJECTS} onChange={setValues} />;
    }

    render(<ControlledTaskForm />);

    const textarea = screen.getByLabelText("Описание · markdown");
    await userEvent.type(textarea, "Начало.");
    expect(textarea).toHaveValue("Начало.");

    onTextRef.current("Продолжение.");

    expect(await screen.findByDisplayValue("Начало. Продолжение.")).toBeInTheDocument();
  });

  it("кнопка микрофона запускает диктовку", async () => {
    render(<TaskForm values={VALUES} projects={PROJECTS} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /надиктовать описание/i }));

    expect(mockDictation.toggle).toHaveBeenCalled();
  });

  it("parseTags остаётся прежним", () => {
    expect(parseTags(" Infra, HOME ,, ")).toEqual(["infra", "home"]);
  });
});

describe("TaskForm — aria-live индикатора диктовки", () => {
  beforeEach(() => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    mockDictation.notice = null;
    mockDictation.seconds = 0;
  });

  it("счётчик записи не объявляется через aria-live и скрыт от скринридера", () => {
    mockDictation.state = "recording";
    mockDictation.seconds = 5;
    const { container } = render(
      <TaskForm values={VALUES} projects={PROJECTS} onChange={vi.fn()} />,
    );

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeNull();
    expect(liveRegion).toBeEmptyDOMElement();

    const counter = screen.getByText(/запись… 5с/);
    expect(counter).toHaveAttribute("aria-hidden", "true");
    expect(liveRegion?.contains(counter)).toBe(false);
  });

  it("ошибка диктовки объявляется через aria-live", () => {
    mockDictation.error = "Не удалось распознать речь";
    mockDictation.notice = null;
    const { container } = render(
      <TaskForm values={VALUES} projects={PROJECTS} onChange={vi.fn()} />,
    );

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toHaveTextContent("Не удалось распознать речь");
  });

  it("notice о тишине скрыт от скринридера и не выглядит как ошибка", () => {
    mockDictation.notice = "Ничего не распознано";
    const { container } = render(
      <TaskForm values={VALUES} projects={PROJECTS} onChange={vi.fn()} />,
    );

    const liveRegion = container.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeEmptyDOMElement();

    const notice = screen.getByText("Ничего не распознано");
    expect(notice).toHaveAttribute("aria-hidden", "true");
    expect(notice.className).not.toContain("field-error");
  });
});
