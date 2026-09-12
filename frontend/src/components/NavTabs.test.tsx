import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import NavTabs from "./NavTabs";

describe("NavTabs", () => {
  it("подсвечивает текущую вкладку и ведёт на другую", () => {
    render(
      <MemoryRouter initialEntries={["/expenses"]}>
        <NavTabs />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link", { name: "траты" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "задачи" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "задачи" })).toHaveAttribute("href", "/board");
  });
});
