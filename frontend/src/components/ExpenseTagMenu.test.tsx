import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import type { Expense } from "../types";
import ExpenseCard from "./ExpenseCard";

const EXPENSE: Expense = {
  id: 1, title: "Интернет", note: "", amount: 90000, status: "recurring", period: "month",
  anchor_date: "2026-01-15", active: true, purchased_at: null, tags: ["дом"], sort_order: 1,
  source: "manual", created_at: "2026-01-01", updated_at: "2026-01-01", next_charge: "2026-09-15",
};
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(["expenses", ""], [EXPENSE]);
  const onOpen = vi.fn();
  vi.spyOn(api, "expenses").mockResolvedValue([EXPENSE, { ...EXPENSE, id: 2, active: false, tags: ["работа", "дом"] }]);
  render(<QueryClientProvider client={client}><ExpenseCard expense={EXPENSE} onOpen={onOpen} clickGuard={{ current: false }} /></QueryClientProvider>);
  const card = screen.getByRole("button");
  return { card, onOpen, client };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("expense tag context menu", () => {
  it("opens on right click, includes tags outside the filtered board and preserves other tags", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, tags: ["дом", "работа"] });
    const { card, onOpen, client } = setup();
    fireEvent.contextMenu(card, { clientX: 100, clientY: 100 });
    expect(await screen.findByRole("menuitemcheckbox", { name: "дом" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "работа" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(patch).toHaveBeenCalledWith(1, { tags: ["дом", "работа"] });
    expect(client.getQueryData<Expense[]>(["expenses", ""])?.[0].tags).toEqual(["дом", "работа"]);
    expect(api.expenses).toHaveBeenCalledWith(new URLSearchParams({ include_inactive: "true" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("can remove the last assigned tag", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, tags: [] });
    const { card } = setup();
    fireEvent.contextMenu(card);
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "дом" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(1, { tags: [] }));
  });
  it("creates and normalizes a new tag without replacing existing tags", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockResolvedValue({ ...EXPENSE, tags: ["дом", "связь"] });
    const { card } = setup();
    fireEvent.contextMenu(card);
    await userEvent.click(screen.getByRole("menuitem", { name: "Новый тег…" }));
    await userEvent.type(screen.getByLabelText("Название тега"), "  Связь  ");
    await userEvent.click(screen.getByRole("button", { name: "Добавить тег" }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(1, { tags: ["дом", "связь"] }));
  });
  it("does not duplicate an assigned tag or send a redundant patch", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    const { card } = setup();
    fireEvent.contextMenu(card);
    await userEvent.click(screen.getByRole("menuitem", { name: "Новый тег…" }));
    await userEvent.type(screen.getByLabelText("Название тега"), " ДОМ ");
    await userEvent.click(screen.getByRole("button", { name: "Добавить тег" }));
    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the menu and existing data after a failed save and allows retry", async () => {
    const patch = vi.spyOn(api, "patchExpense").mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ ...EXPENSE, tags: ["дом", "работа"] });
    const { card, client } = setup();
    fireEvent.contextMenu(card);
    await userEvent.click(await screen.findByRole("menuitemcheckbox", { name: "работа" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось сохранить");
    expect(client.getQueryData<Expense[]>(["expenses", ""])?.[0].tags).toEqual(["дом"]);
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "работа" }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(patch).toHaveBeenCalledTimes(2);
  });
  it("supports keyboard opening, focus navigation, Escape and returning focus", async () => {
    const { card, onOpen } = setup();
    card.focus();
    fireEvent.keyDown(card, { key: "F10", shiftKey: true });
    await screen.findByRole("menuitemcheckbox", { name: "работа" });
    screen.getByRole("menuitemcheckbox", { name: "дом" }).focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitemcheckbox", { name: "работа" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(card).toHaveFocus();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("opens after a touch hold and suppresses the following click", async () => {
    vi.useFakeTimers();
    const { card, onOpen } = setup();
    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 20, clientY: 20 });
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.pointerUp(card);
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("cancels the touch hold when dragging or releasing", async () => {
    vi.useFakeTimers();
    const { card } = setup();
    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerMove(card, { pointerType: "touch", clientX: 40, clientY: 20 });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.pointerDown(card, { pointerType: "touch", clientX: 20, clientY: 20 });
    fireEvent.pointerUp(card);
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("shows a list loading error and recovers through retry", async () => {
    const { card } = setup();
    vi.mocked(api.expenses).mockRejectedValueOnce(new Error("offline"));
    fireEvent.contextMenu(card);
    expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось загрузить");
    await userEvent.click(screen.getByRole("menuitem", { name: "Повторить загрузку" }));
    expect(await screen.findByRole("menuitemcheckbox", { name: "работа" })).toBeInTheDocument();
  });

  it("rejects empty tag names and returns focus after cancelling creation", async () => {
    const patch = vi.spyOn(api, "patchExpense");
    const { card } = setup();
    fireEvent.contextMenu(card);
    await userEvent.click(screen.getByRole("menuitem", { name: "Новый тег…" }));
    await userEvent.type(screen.getByLabelText("Название тега"), "   ");
    expect(screen.getByRole("button", { name: "Добавить тег" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(card).toHaveFocus();
    expect(patch).not.toHaveBeenCalled();
  });

  it("prevents duplicate writes while saving", async () => {
    let resolve!: (expense: Expense) => void;
    const patch = vi.spyOn(api, "patchExpense").mockReturnValue(new Promise<Expense>((done) => { resolve = done; }));
    const { card } = setup();
    fireEvent.contextMenu(card);
    const tag = await screen.findByRole("menuitemcheckbox", { name: "работа" });
    fireEvent.click(tag);
    fireEvent.click(tag);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await act(async () => resolve({ ...EXPENSE, tags: ["дом", "работа"] }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
