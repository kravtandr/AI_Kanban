import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import ExpenseQuickAdd from "./ExpenseQuickAdd";

// Реальная форма useDictation (frontend/src/lib/useDictation.ts) —
// { supported, state, error, notice, seconds, toggle } — не совпадает с
// черновым мок-объектом из брифа ({ recording, start, stop }). MicButton
// читает dictation.state/.toggle/.supported, так что мок обязан отдавать
// именно это, иначе тест пройдёт, ничего не проверив про реальную интеграцию.
vi.mock("../lib/useDictation", () => ({
  useDictation: () => ({
    supported: false,
    state: "idle" as const,
    error: null,
    notice: null,
    seconds: 0,
    toggle: () => {},
  }),
  appendTranscript: (a: string, b: string) => `${a} ${b}`,
}));

function renderIt() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpenseQuickAdd />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.restoreAllMocks());

describe("ExpenseQuickAdd", () => {
  it("черновик открывает форму с полями из ответа", async () => {
    vi.spyOn(api, "draftExpense").mockResolvedValue({
      draft: {
        title: "Netflix", amount_rub: 899, status: "recurring", period: "month",
        anchor_date: "2026-09-15", tags: ["tv"],
      },
      amount: 89900, ai_ok: true, ai_error: null,
    });
    renderIt();
    await userEvent.type(screen.getByPlaceholderText(/трат/i), "нетфликс 899{enter}");
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByLabelText("Название")).toHaveValue("Netflix");
    expect(screen.getByLabelText("Сумма, ₽")).toHaveValue("899");
    expect(screen.getByRole("radio", { name: "Регулярная" })).toBeChecked();
    expect(screen.getByLabelText("Дата списания")).toHaveValue("2026-09-15");
  });

  it("деградация: ai_ok false — форма открыта, есть предупреждение", async () => {
    vi.spyOn(api, "draftExpense").mockResolvedValue({
      draft: { title: "что-то", amount_rub: null, status: "wanted", period: null, anchor_date: null, tags: [] },
      amount: 0, ai_ok: false, ai_error: "LLM is not configured",
    });
    renderIt();
    await userEvent.type(screen.getByPlaceholderText(/трат/i), "что-то{enter}");
    await waitFor(() => expect(screen.getByText(/AI недоступен/)).toBeInTheDocument());
  });

  // Вторая ветка деградации из глобальных ограничений задачи: не только
  // ai_ok: false, но и сам api.draftExpense может бросить (сеть, 5xx).
  // Отсутствует в исходном брифе, но явно обязательна («форма всё равно
  // открывается, предупреждение называет причину») — без этого теста
  // catch-ветка компонента ничем не подтверждена.
  it("деградация: запрос падает — форма всё равно открыта, предупреждение и исходный текст в названии", async () => {
    vi.spyOn(api, "draftExpense").mockRejectedValue(new Error("сеть недоступна"));
    renderIt();
    await userEvent.type(screen.getByPlaceholderText(/трат/i), "что-то{enter}");
    await waitFor(() => expect(screen.getByText(/AI недоступен/)).toBeInTheDocument());
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Название")).toHaveValue("что-то");
  });

  // Хоткей — глобальное ограничение задачи (регистрируется самим
  // компонентом, игнорирует фокус в полях, не ворует Cmd/Ctrl+N). В брифе
  // нет теста на это (как и в QuickAdd.test.tsx для исходного QuickAdd),
  // но раз это явное связывающее ограничение — стоит недорогой проверки.
  it("хоткей n фокусирует поле ввода, игнорирует фокус в другом поле и не ворует Ctrl/Cmd+N", () => {
    renderIt();
    const quickAddInput = screen.getByPlaceholderText(/трат/i);

    fireEvent.keyDown(window, { key: "n" });
    expect(quickAddInput).toHaveFocus();

    quickAddInput.blur();
    const other = document.createElement("input");
    document.body.appendChild(other);
    other.focus();
    fireEvent.keyDown(other, { key: "n" });
    expect(other).toHaveFocus();
    document.body.removeChild(other);

    quickAddInput.blur();
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(quickAddInput).not.toHaveFocus();
  });
});
