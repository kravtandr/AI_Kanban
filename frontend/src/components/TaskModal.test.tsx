import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Project, Task } from "../types";
import TaskModal from "./TaskModal";

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

const PROJECTS: Project[] = [
  {
    id: 2,
    name: "Сварог",
    color: "#38bdf8",
    description: "",
    is_inbox: false,
    archived_at: null,
    active_tasks: 1,
  },
];

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TaskModal — оценка", () => {
  it("выбранный бакет уходит в PATCH", async () => {
    const patch = vi.spyOn(api, "patchTask").mockResolvedValue(TASK);
    renderWithQuery(<TaskModal task={TASK} projects={PROJECTS} onClose={vi.fn()} />);

    await userEvent.selectOptions(screen.getByLabelText("Оценка"), "M");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(7, { estimate: "M" }));
  });

  it("⌀ поверх существующей оценки шлёт clear_estimate, а не estimate: null", async () => {
    const patch = vi.spyOn(api, "patchTask").mockResolvedValue(TASK);
    renderWithQuery(
      <TaskModal task={{ ...TASK, estimate: "L" }} projects={PROJECTS} onClose={vi.fn()} />,
    );

    await userEvent.selectOptions(screen.getByLabelText("Оценка"), "");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    // Голый estimate: null молча потерялся бы в update_task на условии
    // `is not None`, и задача осталась бы со старой оценкой (§5.2, §9.1).
    await waitFor(() => expect(patch).toHaveBeenCalledWith(7, { clear_estimate: true }));
  });

  it("нетронутая оценка в патч не попадает", async () => {
    const patch = vi.spyOn(api, "patchTask").mockResolvedValue(TASK);
    renderWithQuery(
      <TaskModal task={{ ...TASK, estimate: "S" }} projects={PROJECTS} onClose={vi.fn()} />,
    );

    await userEvent.type(screen.getByLabelText("Название"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    await waitFor(() => expect(patch).toHaveBeenCalledWith(7, { title: "Сделать UI!" }));
  });
});
