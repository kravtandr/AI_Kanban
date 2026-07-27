import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

const onTextRef = vi.hoisted(() => ({ current: (_: string) => {} }));
const mockDictation = vi.hoisted(() => ({
  supported: true,
  state: "idle" as "idle" | "recording" | "transcribing",
  error: null as string | null,
  seconds: 0,
  toggle: vi.fn(),
}));

vi.mock("../lib/useDictation", () => ({
  useDictation: (onText: (text: string) => void) => {
    onTextRef.current = onText;
    return mockDictation;
  },
  recordingSupported: () => mockDictation.supported,
}));

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

  it("кнопка микрофона запускает диктовку", async () => {
    render(<TaskForm values={VALUES} projects={PROJECTS} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /надиктовать описание/i }));

    expect(mockDictation.toggle).toHaveBeenCalled();
  });

  it("parseTags остаётся прежним", () => {
    expect(parseTags(" Infra, HOME ,, ")).toEqual(["infra", "home"]);
  });
});
