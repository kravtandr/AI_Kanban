import { describe, expect, it } from "vitest";
import type { Project } from "../types";
import { findProjectByName, projectMenuItems } from "./projectMenu";

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

const PROJECTS = [project(1, "Inbox", true), project(2, "Сварог"), project(3, "Аудио")];

describe("projectMenuItems", () => {
  it("сортирует проекты по алфавиту, Inbox — последним", () => {
    expect(projectMenuItems(PROJECTS, 2).map((i) => i.name)).toEqual(["Аудио", "Сварог", "Inbox"]);
  });

  it("Inbox остаётся в меню: вернуть задачу в Inbox вручную — законное действие", () => {
    expect(projectMenuItems(PROJECTS, 2).some((i) => i.name === "Inbox")).toBe(true);
  });

  it("помечает текущий проект", () => {
    const items = projectMenuItems(PROJECTS, 2);
    expect(items.filter((i) => i.current).map((i) => i.id)).toEqual([2]);
  });

  it("не падает на пустом списке", () => {
    expect(projectMenuItems([], 1)).toEqual([]);
  });
});

describe("findProjectByName", () => {
  it("находит без учёта регистра — этим разрешается 409 от POST /projects", () => {
    expect(findProjectByName(PROJECTS, "сВаРоГ")?.id).toBe(2);
  });

  it("игнорирует окружающие пробелы", () => {
    expect(findProjectByName(PROJECTS, "  Аудио  ")?.id).toBe(3);
  });

  it("возвращает undefined, если имени нет — значит проект в архиве", () => {
    expect(findProjectByName(PROJECTS, "Архивный")).toBeUndefined();
  });
});
