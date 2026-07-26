import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import TaskContextMenu from "./TaskContextMenu";

function project(id: number, name: string, isInbox = false): Project {
  return {
    id,
    name,
    color: "#888888",
    description: "",
    is_inbox: isInbox,
    archived_at: null,
    active_tasks: 0,
  };
}

const PROJECTS = [project(1, "Inbox", true), project(2, "Сварог")];

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    projects: PROJECTS,
    currentProjectId: 1,
    at: { x: 10, y: 10 },
    onPick: vi.fn(),
    onCreateNew: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<TaskContextMenu {...props} />);
  return props;
}

describe("TaskContextMenu", () => {
  it("рендерит проекты как radio-пункты меню", () => {
    setup();
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.getAllByRole("menuitemradio").map((n) => n.textContent)).toEqual([
      "Сварог",
      "Inbox✓",
    ]);
  });

  it("отмечает текущий проект через aria-checked", () => {
    setup({ currentProjectId: 2 });
    expect(screen.getByRole("menuitemradio", { name: /Сварог/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("menuitemradio", { name: /Inbox/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("по выбору проекта отдаёт его id и закрывается", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Сварог/ }));
    expect(props.onPick).toHaveBeenCalledWith(2);
    expect(props.onClose).toHaveBeenCalled();
  });

  it("не дёргает onPick по текущему проекту — менять нечего", async () => {
    const props = setup({ currentProjectId: 2 });
    await userEvent.click(screen.getByRole("menuitemradio", { name: /Сварог/ }));
    expect(props.onPick).not.toHaveBeenCalled();
    expect(props.onClose).toHaveBeenCalled();
  });

  it("предлагает создать новый проект отдельным пунктом", async () => {
    const props = setup();
    await userEvent.click(screen.getByRole("menuitem", { name: /новый проект/i }));
    expect(props.onCreateNew).toHaveBeenCalled();
  });

  it("Escape закрывает меню", async () => {
    const props = setup();
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });

  it("стрелка вниз переводит фокус на следующий пункт", async () => {
    setup();
    const items = screen.getAllByRole("menuitemradio");
    expect(items[0]).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
  });

  it("Tab не уводит фокус из меню", async () => {
    setup();
    const items = screen.getAllByRole("menuitemradio");
    await userEvent.tab();
    // Ловушка: фокус остался внутри меню, а не ушёл на доску под ним.
    expect(items[1]).toHaveFocus();
  });

  it("возвращает фокус на элемент, из которого меню вызвали", () => {
    const opener = document.createElement("button");
    opener.textContent = "карточка";
    document.body.append(opener);
    opener.focus();

    const { unmount } = render(
      <TaskContextMenu
        projects={PROJECTS}
        currentProjectId={1}
        at={{ x: 0, y: 0 }}
        onPick={vi.fn()}
        onCreateNew={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    unmount();

    expect(opener).toHaveFocus();
    opener.remove();
  });
});
