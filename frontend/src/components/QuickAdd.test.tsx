import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../types";
import QuickAdd from "./QuickAdd";

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

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("QuickAdd — диктовка", () => {
  it("кнопка микрофона запускает диктовку", async () => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    mockDictation.notice = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    await userEvent.click(screen.getByRole("button", { name: /надиктовать/i }));

    expect(mockDictation.toggle).toHaveBeenCalled();
  });

  it("во время расшифровки кнопка недоступна", () => {
    mockDictation.state = "transcribing";
    mockDictation.error = null;
    mockDictation.notice = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByRole("button", { name: /распознаю/i })).toBeDisabled();
  });

  it("ошибка диктовки видна пользователю", () => {
    mockDictation.state = "idle";
    mockDictation.error = "Диктовка требует HTTPS — откройте трекер по https://";
    mockDictation.notice = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByText(/требует https/i)).toBeInTheDocument();
  });

  it("расшифровка дописывается к уже набранному тексту, а не заменяет его", async () => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    mockDictation.notice = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    const input = screen.getByLabelText("Быстрое добавление задачи");
    await userEvent.type(input, "Начало.");
    expect(input).toHaveValue("Начало.");

    onTextRef.current("Продолжение.");

    expect(await screen.findByDisplayValue("Начало. Продолжение.")).toBeInTheDocument();
  });

  it("во время расшифровки показывает подсказку «распознаю…»", () => {
    mockDictation.state = "transcribing";
    mockDictation.error = null;
    mockDictation.notice = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByText(/распознаю…/i)).toBeInTheDocument();
  });

  it("notice о тишине показывается приглушённым стилем, а не как ошибка", () => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    mockDictation.notice = "Ничего не распознано";
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    const notice = screen.getByText("Ничего не распознано");
    expect(notice).toHaveAttribute("aria-hidden", "true");
    expect(notice.className).toContain("text-dim");
    expect(notice.className).not.toContain("text-danger");
  });
});
