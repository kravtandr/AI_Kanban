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

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("QuickAdd — диктовка", () => {
  it("кнопка микрофона запускает диктовку", async () => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    await userEvent.click(screen.getByRole("button", { name: /надиктовать/i }));

    expect(mockDictation.toggle).toHaveBeenCalled();
  });

  it("во время расшифровки кнопка недоступна", () => {
    mockDictation.state = "transcribing";
    mockDictation.error = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByRole("button", { name: /распознаю/i })).toBeDisabled();
  });

  it("ошибка диктовки видна пользователю", () => {
    mockDictation.state = "idle";
    mockDictation.error = "Диктовка требует HTTPS — откройте трекер по https://";
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    expect(screen.getByText(/требует https/i)).toBeInTheDocument();
  });

  it("расшифровка дописывается к уже набранному тексту, а не заменяет его", async () => {
    mockDictation.state = "idle";
    mockDictation.error = null;
    renderWithQuery(<QuickAdd projects={PROJECTS} />);

    const input = screen.getByLabelText("Быстрое добавление задачи");
    await userEvent.type(input, "Начало.");
    expect(input).toHaveValue("Начало.");

    onTextRef.current("Продолжение.");

    expect(await screen.findByDisplayValue("Начало. Продолжение.")).toBeInTheDocument();
  });
});
