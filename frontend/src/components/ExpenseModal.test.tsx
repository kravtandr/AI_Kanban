import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Expense } from "../types";
import ExpenseModal from "./ExpenseModal";
import NewExpenseModal from "./NewExpenseModal";

const EXPENSE: Expense = {
  id: 5, title: "Netflix", note: "", amount: 89900, status: "recurring", period: "month",
  anchor_date: "2026-01-15", active: true, purchased_at: null, tags: [], sort_order: 1,
  source: "manual", created_at: "2026-09-01T00:00:00", updated_at: "2026-09-01T00:00:00",
  next_charge: "2026-09-15",
};

function renderModal(expense = EXPENSE) {
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ExpenseModal expense={expense} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

afterEach(() => vi.restoreAllMocks());

describe("ExpenseModal", () => {
  it("PATCH шлёт только изменённые поля, рубли → копейки", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, amount: 99900 });
    const onClose = renderModal();
    const amount = screen.getByLabelText("Сумма, ₽");
    await userEvent.clear(amount);
    await userEvent.type(amount, "999");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(5, { amount: 99900 }));
    expect(onClose).toHaveBeenCalled();
  });

  it("смена регулярной на «хочу» шлёт status и clear_period", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, status: "wanted" });
    renderModal();
    await userEvent.click(screen.getByRole("radio", { name: "Хочу купить" }));
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(5, { status: "wanted", clear_period: true }),
    );
  });

  it("неверная сумма — инлайн-ошибка, запроса нет", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    renderModal();
    const amount = screen.getByLabelText("Сумма, ₽");
    await userEvent.clear(amount);
    await userEvent.type(amount, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(screen.getByText("Введите сумму в рублях")).toBeInTheDocument();
    expect(patch).not.toHaveBeenCalled();
  });

  it("кнопка «Куплено» у wanted вызывает move", async () => {
    const move = vi.spyOn(api, "moveExpense").mockResolvedValue({ ...EXPENSE, status: "bought" });
    renderModal({ ...EXPENSE, status: "wanted", period: null, anchor_date: null, next_charge: null });
    await userEvent.click(screen.getByRole("button", { name: "Куплено" }));
    await waitFor(() => expect(move).toHaveBeenCalledWith(5, "bought"));
  });

  // Регрессия ревью Task 10, находка №3: ExpenseModal.save раньше писал
  // ошибку про дату списания в amountError, и она рендерилась под «Сумма, ₽»
  // — не под тем полем. Клик по «Сохранить» тут не подошёл бы: required у
  // <input type="date"> и так блокирует submit нативно в jsdom (проверено
  // отдельно), маскируя баг. Он реален только на Ctrl+Enter (Modal.tsx),
  // который зовёт onSubmit напрямую в обход required — так и воспроизводим.
  it("сохранение регулярной с очищенной датой списания — ошибка под полем даты, PATCH не улетает", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    renderModal();
    const anchorDate = screen.getByLabelText("Дата списания");
    fireEvent.change(anchorDate, { target: { value: "" } });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(anchorDate).toHaveAccessibleDescription("У регулярной траты нужна дата списания");
    expect(patch).not.toHaveBeenCalled();
  });

  // Находка №4: buildPatch раньше слал `purchased_at: form.purchased_at || undefined`,
  // JSON.stringify роняет undefined — запрос уходил «успешно», ничего не менялось.
  // Теперь это блокируется как ошибка валидации до вызова buildPatch.
  it("сохранение купленной с очищенной датой покупки — инлайн-ошибка, PATCH не улетает", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    renderModal({
      ...EXPENSE, status: "bought", period: null, anchor_date: null,
      purchased_at: "2026-08-20", next_charge: null,
    });
    const purchasedAt = screen.getByLabelText("Дата покупки");
    fireEvent.change(purchasedAt, { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(purchasedAt).toHaveAccessibleDescription("Укажите дату покупки");
    expect(patch).not.toHaveBeenCalled();
  });

  // Round 2 regression: dateError — общий слот на форме, но ни одна модалка
  // не чистила его при смене form.status. Взводим ошибку «Дата списания» на
  // регулярной, затем кликом переключаемся на «Куплено» — блок «Дата
  // покупки» монтируется с валидной автоподставленной датой, но старое
  // сообщение (про другое поле) раньше оставалось прицепленным к нему же
  // через общий dateErrId.
  it("смена на «Куплено» после ошибки даты списания не тащит её на «Дата покупки»", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    renderModal();
    const anchorDate = screen.getByLabelText("Дата списания");
    fireEvent.change(anchorDate, { target: { value: "" } });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(anchorDate).toHaveAccessibleDescription("У регулярной траты нужна дата списания");
    await userEvent.click(screen.getByRole("radio", { name: "Куплено" }));
    const purchasedAt = screen.getByLabelText("Дата покупки");
    expect(purchasedAt).not.toHaveAccessibleDescription();
    expect(purchasedAt).not.toHaveAttribute("aria-invalid");
    expect(patch).not.toHaveBeenCalled();
  });

  // Обратное направление того же бага, обычным кликом (без Ctrl+Enter):
  // взводим ошибку «Дата покупки» на купленной, переключаемся на
  // «Регулярная» — «Дата списания» монтируется с валидной автоподставленной
  // датой и не должна унаследовать чужое сообщение.
  it("смена на «Регулярная» после ошибки даты покупки не тащит её на «Дата списания»", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    renderModal({
      ...EXPENSE, status: "bought", period: null, anchor_date: null,
      purchased_at: "2026-08-20", next_charge: null,
    });
    const purchasedAt = screen.getByLabelText("Дата покупки");
    fireEvent.change(purchasedAt, { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(purchasedAt).toHaveAccessibleDescription("Укажите дату покупки");
    await userEvent.click(screen.getByRole("radio", { name: "Регулярная" }));
    const anchorDate = screen.getByLabelText("Дата списания");
    expect(anchorDate).not.toHaveAccessibleDescription();
    expect(anchorDate).not.toHaveAttribute("aria-invalid");
    expect(patch).not.toHaveBeenCalled();
  });

  // Находка №2: кнопка удаления — один и тот же DOM-узел до и после взвода,
  // без разоружения и без порога по времени, поэтому двойной клик (одним
  // физическим жестом) взводил и тут же удалял.
  it("двойной клик по «Удалить» не удаляет одним жестом", async () => {
    const del = vi.spyOn(api, "deleteExpense").mockResolvedValue(undefined);
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    await userEvent.click(screen.getByRole("button", { name: "Точно удалить?" }));
    expect(del).not.toHaveBeenCalled();
  });

  it("клик, пауза дольше порога, затем клик — удаляет", async () => {
    const del = vi.spyOn(api, "deleteExpense").mockResolvedValue(undefined);
    renderModal();
    await userEvent.click(screen.getByRole("button", { name: "Удалить" }));
    // Настоящая пауза, а не vi.useFakeTimers(): весь сьют кликает через
    // userEvent и мутирует через react-query — оба внутри полагаются на
    // реальные таймеры/микрозадачи, и включать поддельные пришлось бы для
    // всего файла разом, рискуя не разбуженными промисами в других тестах.
    // 500мс — с запасом выше 400мс-порога ExpenseModal, тест не станет
    // заметно медленнее.
    await new Promise((resolve) => setTimeout(resolve, 500));
    await userEvent.click(screen.getByRole("button", { name: "Точно удалить?" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith(5));
  });
});

describe("NewExpenseModal", () => {
  // Находка №1: NewExpenseModal.submit проверял только title/amount; через
  // Ctrl+Enter можно было создать `status: "recurring", anchor_date: null` —
  // сервер отвечает 400, UI показывал его как сырую ошибку. Клик по
  // «Создать» не воспроизвёл бы баг: required у поля даты и так блокирует
  // submit нативно в jsdom — уязвим именно прямой вызов onSubmit по
  // Ctrl+Enter (Modal.tsx), в обход required.
  it("создание регулярной с очищенной датой списания — инлайн-ошибка, createExpense не вызывается", async () => {
    const create = vi.spyOn(api, "createExpense");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewExpenseModal status="recurring" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText("Название"), "Зал");
    await userEvent.type(screen.getByLabelText("Сумма, ₽"), "2500");
    fireEvent.change(screen.getByLabelText("Дата списания"), { target: { value: "" } });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(screen.getByLabelText("Дата списания")).toHaveAccessibleDescription(
      "У регулярной траты нужна дата списания",
    );
    expect(create).not.toHaveBeenCalled();
  });

  // Round 2: тот же фикс, что и у ExpenseModal ("обе модалки нуждаются в
  // одинаковом лечении" — бриф раунда 2). У NewExpenseModal нет проверки
  // bought/purchased_at (formToBody вообще не шлёт purchased_at), поэтому
  // тут воспроизводимо только направление recurring → bought.
  it("смена на «Куплено» после ошибки даты списания не тащит её на «Дата покупки»", async () => {
    const create = vi.spyOn(api, "createExpense");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <NewExpenseModal status="recurring" onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    await userEvent.type(screen.getByLabelText("Название"), "Зал");
    await userEvent.type(screen.getByLabelText("Сумма, ₽"), "2500");
    fireEvent.change(screen.getByLabelText("Дата списания"), { target: { value: "" } });
    fireEvent.keyDown(document, { key: "Enter", ctrlKey: true });
    expect(screen.getByLabelText("Дата списания")).toHaveAccessibleDescription(
      "У регулярной траты нужна дата списания",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Куплено" }));
    const purchasedAt = screen.getByLabelText("Дата покупки");
    expect(purchasedAt).not.toHaveAccessibleDescription();
    expect(purchasedAt).not.toHaveAttribute("aria-invalid");
    expect(create).not.toHaveBeenCalled();
  });
});
