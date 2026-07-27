import { useId, type Ref } from "react";
import { useDictation } from "../lib/useDictation";
import MicButton from "./MicButton";
import type { Priority, Project, Status } from "../types";
import { PRIORITIES, STATUSES } from "../types";

export interface TaskFormValues {
  title: string;
  description: string;
  project_id: number;
  status: Status;
  priority: Priority;
  tags: string;
  due_date: string;
}

interface Props {
  values: TaskFormValues;
  projects: Project[];
  onChange: (values: TaskFormValues) => void;
  showStatus?: boolean;
  /** Инлайн-ошибка названия. Кнопка сабмита остаётся активной — причину
   * объясняем здесь, а не молчаливым disabled. */
  titleError?: string | null;
  /** Чтобы вызывающая модалка могла увести фокус на первую ошибку. */
  titleRef?: Ref<HTMLInputElement>;
}

export default function TaskForm({
  values,
  projects,
  onChange,
  showStatus = false,
  titleError = null,
  titleRef,
}: Props) {
  const set = (patch: Partial<TaskFormValues>) => onChange({ ...values, ...patch });
  const errorId = useId();

  // Диктовка дописывает текст к описанию, а не заменяет его: пользователь
  // мог начать печатать до того, как взялся за микрофон.
  const dictation = useDictation((text) =>
    set({ description: values.description ? `${values.description.trimEnd()} ${text}` : text }),
  );

  return (
    <div className="flex flex-col gap-3">
      <div>
        <label className="block">
          <span className="eyebrow">Название</span>
          <input
            ref={titleRef}
            name="title"
            autoComplete="off"
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
            maxLength={200}
            required
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? errorId : undefined}
            className="input"
          />
        </label>
        {titleError && (
          <span id={errorId} className="field-error">
            {titleError}
          </span>
        )}
      </div>
      <div>
        <div className="flex items-end justify-between gap-2">
          <span className="eyebrow">Описание · markdown</span>
          <MicButton dictation={dictation} target="описание" compact />
        </div>
        <textarea
          name="description"
          aria-label="Описание"
          value={values.description}
          onChange={(e) => set({ description: e.target.value })}
          rows={5}
          className="input font-mono text-[13px]"
        />
        <span aria-live="polite">
          {dictation.error && <span className="field-error">{dictation.error}</span>}
          {!dictation.error && dictation.state === "recording" && (
            <span className="font-mono text-[11px] text-dim">запись… {dictation.seconds}с</span>
          )}
          {dictation.state === "transcribing" && (
            <span className="font-mono text-[11px] text-dim">распознаю…</span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="eyebrow">Проект</span>
          <select
            name="project_id"
            value={values.project_id}
            onChange={(e) => set({ project_id: Number(e.target.value) })}
            className="input"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="eyebrow">Приоритет</span>
          <select
            name="priority"
            value={values.priority}
            onChange={(e) => set({ priority: e.target.value as Priority })}
            className="input"
          >
            {PRIORITIES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>
        {showStatus && (
          <label className="block">
            <span className="eyebrow">Колонка</span>
            <select
              name="status"
              value={values.status}
              onChange={(e) => set({ status: e.target.value as Status })}
              className="input"
            >
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block">
          <span className="eyebrow">Срок</span>
          <input
            type="date"
            name="due_date"
            autoComplete="off"
            value={values.due_date}
            onChange={(e) => set({ due_date: e.target.value })}
            className="input"
          />
        </label>
      </div>
      <label className="block">
        <span className="eyebrow">Теги · через запятую</span>
        <input
          name="tags"
          autoComplete="off"
          spellCheck={false}
          value={values.tags}
          onChange={(e) => set({ tags: e.target.value })}
          placeholder="infra, home…"
          className="input font-mono text-[13px]"
        />
      </label>
    </div>
  );
}

export function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}
