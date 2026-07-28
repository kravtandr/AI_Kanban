import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { formatDue } from "../lib/dates";
import { useDictation } from "../lib/useDictation";
import type { Project } from "../types";
import { PRIORITIES } from "../types";
import MicButton from "./MicButton";
import Modal from "./Modal";
import TaskForm, { parseTags, type TaskFormValues } from "./TaskForm";

interface Props {
  projects: Project[];
}

interface DraftItem {
  id: number;
  text: string;
  status: "pending" | "ready" | "creating";
  aiOk?: boolean;
  aiError?: string | null;
  form?: TaskFormValues;
}

const STORAGE_KEY = "tasktracker.quickadd.drafts";

function fallbackForm(text: string, projectId: number): TaskFormValues {
  return {
    title: text,
    description: "",
    project_id: projectId,
    status: "todo",
    priority: "medium",
    tags: "",
    due_date: "",
  };
}

/** Черновики переживают перезагрузку и 401-редирект через sessionStorage.
 * Элементы, чей запрос был в полёте (pending/creating), восстанавливаются
 * как ready-черновики на доработку — результат запроса неизвестен. */
function restoreItems(): DraftItem[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as DraftItem[])
      .filter((it) => typeof it?.id === "number" && typeof it?.text === "string")
      .map((it) =>
        it.status === "ready" && it.form
          ? it
          : {
              id: it.id,
              text: it.text,
              status: "ready" as const,
              aiOk: false,
              aiError: "прервано перезагрузкой — проверьте черновик",
              form: it.form ?? fallbackForm(it.text, 0),
            },
      );
  } catch {
    return [];
  }
}

/** Командная строка задач — главный вход в трекер. На десктопе живёт в
 * шапке, на мобильном прибита к низу экрана (зона большого пальца).
 * Enter отправляет текст модели и сразу освобождает ввод; черновики
 * копятся в лотке и одобряются по одному или пачкой. Микрофон диктует
 * в то же поле: запись уходит на собственный Whisper (ADR-0007). */
export default function QuickAdd({ projects }: Props) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<DraftItem[]>(restoreItems);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [confirmDiscardId, setConfirmDiscardId] = useState<number | null>(null);
  const [draftTitleError, setDraftTitleError] = useState<string | null>(null);
  const nextId = useRef(items.reduce((max, it) => Math.max(max, it.id), 0) + 1);
  const inputRef = useRef<HTMLInputElement>(null);
  const draftTitleRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  // Расшифровка дописывается к тому, что уже набрано руками
  const dictation = useDictation((text) =>
    setText((prev) => (prev ? `${prev.trimEnd()} ${text}` : text)),
  );

  // Актуальная очередь для асинхронных циклов (createAll):
  // state-снапшот в замыкании устаревает, ref — нет.
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Персистим очередь: DraftItem — плоские данные, сериализуются как есть
  useEffect(() => {
    try {
      if (items.length === 0) sessionStorage.removeItem(STORAGE_KEY);
      else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // приватный режим / квота — черновики просто не переживут перезагрузку
    }
  }, [items]);

  // Непустая очередь — предупреждаем перед закрытием вкладки
  useEffect(() => {
    if (items.length === 0) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [items.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (
        event.key === "n" &&
        !event.metaKey && // не воровать браузерные Cmd+N / Ctrl+N
        !event.ctrlKey &&
        !event.altKey &&
        !target.isContentEditable &&
        !["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      ) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inboxId = projects.find((p) => p.is_inbox)?.id ?? projects[0]?.id ?? 0;
  const projectsReady = projects.length > 0;

  // Черновики, восстановленные до загрузки проектов, получили project_id: 0 —
  // как только справочник готов, подставляем инбокс
  useEffect(() => {
    if (!inboxId) return;
    setItems((prev) =>
      prev.map((it) =>
        it.form && it.form.project_id === 0
          ? { ...it, form: { ...it.form, project_id: inboxId } }
          : it,
      ),
    );
  }, [inboxId]);

  const patchItem = (id: number, patch: Partial<DraftItem>) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));

  // Отбрасывание черновика необратимо, поэтому в два шага: первый клик
  // взводит подтверждение, второй удаляет. Взвод сам спадает через 4с,
  // иначе клик через минуту сработал бы неожиданно.
  useEffect(() => {
    if (confirmDiscardId === null) return;
    const timer = setTimeout(() => setConfirmDiscardId(null), 4000);
    return () => clearTimeout(timer);
  }, [confirmDiscardId]);

  function discard(id: number) {
    if (confirmDiscardId !== id) {
      setConfirmDiscardId(id);
      return;
    }
    setConfirmDiscardId(null);
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  async function submitText(event: React.FormEvent) {
    event.preventDefault();
    if (!projectsReady) return; // без проектов улетел бы project_id: 0
    const value = text.trim();
    if (!value) return;
    setText(""); // поле свободно — печатайте следующую, пока модель думает
    const id = nextId.current++;
    setItems((prev) => [...prev, { id, text: value, status: "pending" }]);
    try {
      const resp = await api.draft(value);
      // ИИ мог создать новый проект под этот черновик — до invalidate
      // вставляем минимальную запись, чтобы селект и чип проекта не были
      // транзиентно пустыми, пока идёт refetch справочника
      const cached = queryClient.getQueryData<Project[]>(["projects"]);
      if (cached && !cached.some((p) => p.id === resp.project_id)) {
        queryClient.setQueryData<Project[]>(["projects"], [
          ...cached,
          {
            id: resp.project_id,
            name: resp.draft.project ?? "…",
            color: "#6b7280",
            description: resp.draft.project_description ?? "",
            is_inbox: false,
            archived_at: null,
            active_tasks: 0,
          },
        ]);
      }
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      patchItem(id, {
        status: "ready",
        aiOk: resp.ai_ok,
        aiError: resp.ai_error,
        form: {
          title: resp.draft.title,
          description: resp.draft.description,
          project_id: resp.project_id,
          status: "todo",
          priority: resp.draft.priority,
          tags: resp.draft.tags.join(", "),
          due_date: resp.draft.due_date ?? "",
        },
      });
    } catch (err) {
      patchItem(id, {
        status: "ready",
        aiOk: false,
        aiError: err instanceof Error ? err.message : "сеть недоступна",
        form: fallbackForm(value, inboxId),
      });
    }
  }

  async function createItem(item: DraftItem) {
    if (!item.form || item.status !== "ready") return;
    patchItem(item.id, { status: "creating" });
    try {
      await api.createTask({
        title: item.form.title,
        description: item.form.description,
        project_id: item.form.project_id,
        status: item.form.status,
        priority: item.form.priority,
        tags: parseTags(item.form.tags),
        due_date: item.form.due_date || null,
        source: item.aiOk ? "ai" : "manual",
        ai_meta: item.aiOk ? { source_text: item.text } : undefined,
      });
      setItems((prev) => prev.filter((it) => it.id !== item.id));
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    } catch {
      patchItem(item.id, { status: "ready", aiError: "не удалось создать" });
    }
  }

  async function createAll() {
    // Фиксируем только id: сам элемент перечитываем из актуальной очереди
    // перед созданием — пользователь мог удалить или отредактировать его,
    // пока цикл шёл по предыдущим
    const ids = itemsRef.current.filter((it) => it.status === "ready").map((it) => it.id);
    for (const id of ids) {
      const current = itemsRef.current.find((it) => it.id === id);
      if (!current || current.status !== "ready") continue;
      await createItem(current);
    }
  }

  const readyCount = items.filter((it) => it.status === "ready").length;
  const editingItem = items.find((it) => it.id === editingId);
  const projectName = (id: number) => projects.find((p) => p.id === id)?.name ?? "…";

  // «Создать» остаётся активной: пустое название объясняем инлайн и уводим
  // туда фокус, а не гасим кнопку без объяснения.
  function submitDraft() {
    if (!editingItem?.form) return;
    if (!editingItem.form.title.trim()) {
      setDraftTitleError("Введите название задачи");
      draftTitleRef.current?.focus();
      return;
    }
    setDraftTitleError(null);
    setEditingId(null);
    void createItem(editingItem);
  }

  return (
    <>
      {/* Мобильная позиция fixed требует, чтобы ни у одного предка не было
        backdrop-filter/transform — иначе он станет containing block. */}
      <form
        onSubmit={submitText}
        className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-edge/70 bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:w-full md:max-w-xl md:border-0 md:bg-transparent md:p-0"
      >
        <div className="relative flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 font-mono text-sm text-amber"
          >
            ›
          </span>
          <div className="pointer-events-none absolute bottom-full left-0 z-10 mb-2 w-full">
            {/* aria-live только на ошибке: счётчик записи тикает каждую секунду
              до 120с и, будучи внутри live-региона, зачитывался бы повторно
              всё это время — поэтому он снаружи и помечен aria-hidden. */}
            <div aria-live="polite">
              {dictation.error && (
                <span className="block max-w-full truncate rounded-md border border-edge bg-surface px-2 py-1 font-mono text-[11px] text-danger shadow-xl">
                  {dictation.error}
                </span>
              )}
            </div>
            {!dictation.error && dictation.state === "recording" && (
              <span
                aria-hidden="true"
                className="block max-w-full truncate rounded-md border border-edge bg-surface px-2 py-1 font-mono text-[11px] text-dim italic shadow-xl"
              >
                запись… {dictation.seconds}с
              </span>
            )}
          </div>
          <input
            ref={inputRef}
            name="quick-add"
            autoComplete="off"
            aria-label="Быстрое добавление задачи"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // Симметрично хоткею n: Esc возвращает фокус доске
              if (e.key === "Escape") e.currentTarget.blur();
            }}
            placeholder="опиши задачу — ai оформит…"
            className="input h-11 pl-8 font-mono text-[13px] md:h-10"
          />
        </div>
        <MicButton dictation={dictation} target="задачу" />
        <button
          type="submit"
          disabled={!text.trim() || !projectsReady}
          aria-label="Добавить задачу"
          title={!projectsReady ? "Проекты ещё не загружены" : undefined}
          className="btn-primary h-11 shrink-0 px-4 md:h-10"
        >
          <span aria-hidden="true" className="font-mono md:hidden">
            ↑
          </span>
          <span className="hidden md:inline">Добавить</span>
        </button>
      </form>

      {/* Смонтирована всегда: живая область, появляющаяся вместе с первым
        сообщением, не зачитывается. */}
      <div className="sr-only" aria-live="polite">
        {items.length > 0 ? `Черновиков: ${items.length}, готово к созданию: ${readyCount}` : ""}
      </div>

      {items.length > 0 &&
        createPortal(
          <section
            aria-label="Черновики задач"
            className="fixed inset-x-2 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 md:inset-x-auto md:right-4 md:bottom-4 md:w-[26rem]"
          >
            <div className="max-h-[55vh] overflow-y-auto overscroll-contain rounded-xl border border-edge bg-surface p-3 shadow-2xl md:max-h-[60vh]">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-[11px] tracking-[0.16em] text-dim uppercase">
                  черновики · {items.length}
                </span>
                {readyCount > 0 && (
                  <button onClick={createAll} className="btn-primary px-3 py-1.5 text-xs">
                    Создать все ({readyCount})
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={`rounded-lg border border-edge bg-card p-2.5 ${
                      item.status === "ready" ? "draft-ready" : ""
                    }`}
                  >
                    {item.status === "pending" ? (
                      <div className="flex items-center gap-2 font-mono text-xs text-dim">
                        <span className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-ai border-t-transparent" />
                        <span className="truncate">думаю: {item.text}</span>
                      </div>
                    ) : (
                      <>
                        <div className="mb-1 flex items-start justify-between gap-2">
                          <span className="text-sm leading-snug font-medium">
                            {item.form?.title}
                          </span>
                          <div className="flex shrink-0 gap-1">
                            <button
                              onClick={() => {
                                setDraftTitleError(null);
                                setEditingId(item.id);
                              }}
                              title="Редактировать"
                              aria-label="Редактировать черновик"
                              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-dim transition hover:bg-edge/50 hover:text-ink"
                            >
                              <span aria-hidden="true">✎</span>
                            </button>
                            <button
                              onClick={() => createItem(item)}
                              disabled={item.status === "creating"}
                              title="Создать задачу"
                              aria-label="Создать задачу"
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber text-sm font-semibold text-night transition hover:brightness-110 active:brightness-95 disabled:opacity-40"
                            >
                              <span aria-hidden="true">✓</span>
                            </button>
                            <button
                              onClick={() => discard(item.id)}
                              title={
                                confirmDiscardId === item.id
                                  ? "Нажмите ещё раз, чтобы отбросить"
                                  : "Отбросить черновик"
                              }
                              aria-label={
                                confirmDiscardId === item.id
                                  ? "Подтвердите: отбросить черновик"
                                  : "Отбросить черновик"
                              }
                              className={`flex h-8 w-8 items-center justify-center rounded-lg text-sm transition ${
                                confirmDiscardId === item.id
                                  ? "bg-danger/20 font-semibold text-danger"
                                  : "text-dim hover:bg-danger/15 hover:text-danger"
                              }`}
                            >
                              <span aria-hidden="true">
                                {confirmDiscardId === item.id ? "?" : "✕"}
                              </span>
                            </button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-dim">
                          <span>{projectName(item.form?.project_id ?? 0)}</span>
                          <span>
                            {PRIORITIES.find((p) => p.id === item.form?.priority)?.title.toLowerCase()}
                          </span>
                          {item.form?.due_date && <span>до {formatDue(item.form.due_date)}</span>}
                          {!item.aiOk && (
                            <span className="text-amber" title={item.aiError ?? undefined}>
                              <span aria-hidden="true">⚠</span> без ai
                            </span>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </section>,
          document.body,
        )}

      {editingItem?.form && (
        <Modal onClose={() => setEditingId(null)} onSubmit={submitDraft} title="Черновик задачи">
          <TaskForm
            values={editingItem.form}
            projects={projects}
            onChange={(form) => {
              patchItem(editingItem.id, { form });
              if (draftTitleError && form.title.trim()) setDraftTitleError(null);
            }}
            showStatus
            titleError={draftTitleError}
            titleRef={draftTitleRef}
          />
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => setEditingId(null)} className="btn-ghost">
              Закрыть
            </button>
            <button onClick={submitDraft} className="btn-primary">
              Создать
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
