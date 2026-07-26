import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import NewProjectModal from "./NewProjectModal";

describe("NewProjectModal", () => {
  it("создаёт проект по введённому имени", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<NewProjectModal onCreate={onCreate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/название/i), "Сварог");
    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    expect(onCreate).toHaveBeenCalledWith("Сварог");
  });

  it("объясняет ошибку у поля вместо молчаливого disabled", async () => {
    render(<NewProjectModal onCreate={vi.fn()} onClose={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    const input = screen.getByLabelText(/название/i);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/введите название/i)).toBeInTheDocument();
    expect(input).toHaveFocus();
  });

  it("показывает ошибку от сервера, не закрываясь", async () => {
    const onCreate = vi.fn().mockRejectedValue(new Error("проект в архиве"));
    render(<NewProjectModal onCreate={onCreate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/название/i), "Архивный");
    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    expect(await screen.findByText(/проект в архиве/i)).toBeInTheDocument();
  });

  it("обрезает пробелы вокруг имени", async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    render(<NewProjectModal onCreate={onCreate} onClose={vi.fn()} />);

    await userEvent.type(screen.getByLabelText(/название/i), "  Аудио  ");
    await userEvent.click(screen.getByRole("button", { name: /создать/i }));

    expect(onCreate).toHaveBeenCalledWith("Аудио");
  });
});
