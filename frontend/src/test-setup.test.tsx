import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("окружение компонентных тестов", () => {
  it("рендерит React в jsdom и матчеры jest-dom работают", () => {
    render(<button aria-checked="true">Готово</button>);
    const button = screen.getByRole("button", { name: "Готово" });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute("aria-checked", "true");
  });
});
