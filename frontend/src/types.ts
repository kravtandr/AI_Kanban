export type Status = "backlog" | "todo" | "in_progress" | "done";
export type Priority = "low" | "medium" | "high" | "urgent";

export const STATUSES: { id: Status; title: string }[] = [
  { id: "backlog", title: "Backlog" },
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "done", title: "Done" },
];

/** Приоритет — знак прибора, а не пилюля: medium молчит, остальные метятся. */
export const PRIORITIES: { id: Priority; title: string; mark: string; cls: string }[] = [
  { id: "low", title: "Низкий", mark: "↓", cls: "text-dim/70" },
  { id: "medium", title: "Средний", mark: "", cls: "text-dim" },
  { id: "high", title: "Высокий", mark: "↑", cls: "text-amber" },
  { id: "urgent", title: "Срочно", mark: "‼", cls: "text-danger" },
];

/** Корзины оценки трудозатрат. Пустая строка — «оценки нет» (⌀):
 * в форме это отдельный пункт, в PATCH — флаг clear_estimate. */
export const ESTIMATES = ["XS", "S", "M", "L", "XL"] as const;

export interface Project {
  id: number;
  name: string;
  color: string;
  description: string;
  is_inbox: boolean;
  archived_at: string | null;
  active_tasks: number;
}

export interface Task {
  id: number;
  project_id: number;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  tags: string[];
  due_date: string | null;
  sort_order: number;
  source: "manual" | "ai" | "mcp";
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  /** Зеркало TaskOut.estimate — поле ОБЯЗАТЕЛЬНОЕ, хотя значение бывает null:
   * бэкенд отдаёт ключ в каждом ответе, а необязательность здесь скрыла бы
   * забытую подстановку на сервере. */
  estimate: string | null;
}

export interface TaskDraft {
  title: string;
  description: string;
  project: string | null;
  project_description: string | null;
  priority: Priority;
  tags: string[];
  due_date: string | null;
  /** null, когда заметка не даёт оснований для размера (§9.1). */
  estimate: string | null;
}

export interface DraftResponse {
  draft: TaskDraft;
  project_id: number;
  ai_ok: boolean;
  ai_error: string | null;
}

export interface User {
  id: number;
  username: string;
}

/** Зеркала схем аналитики (§10.1). Ни одна ISO-строка отсюда не разбирается
 * браузером для арифметики: все длительности приходят целыми секундами или
 * минутами, а coverage.as_of — поле подписи. */
export interface Coverage {
  as_of: string;
  window_days: number;
  seeded_tasks: number;
  untracked_tasks: number;
  tracked_tasks: number;
  drift_repaired: number;
  capped_spells: number;
  clock_anomalies: number;
  corpus_size: number;
}

export interface BucketCalibration {
  bucket: string;
  minutes: number;
  seed_minutes: number;
  observed_minutes: number | null;
  samples: number;
  calibrated: boolean;
}

export interface ProjectStat {
  project_id: number;
  project: string;
  color: string;
  closed_minutes: number;
  open_minutes: number;
  factor: number | null;
  relative: number | null;
  samples: number;
}

export interface StuckTask {
  task_id: number;
  title: string;
  status: string;
  days: number;
  spells: number;
}

export interface RunningTask {
  task_id: number;
  title: string;
  /** Только текущий открытый заход. С closed_seconds не складывается нигде. */
  open_seconds: number;
  closed_seconds: number;
  predicted_minutes: number | null;
  over: number | null;
}

export interface Analytics {
  coverage: Coverage;
  board_factor: number | null;
  closed_minutes: number;
  open_minutes: number;
  deleted_minutes: number;
  inversions: string[];
  buckets: BucketCalibration[];
  projects: ProjectStat[];
  stuck: StuckTask[];
  running: RunningTask[];
}

export interface Insights {
  data: Analytics;
  facts: string;
  text: string;
  ai_ok: boolean;
  ai_error: string | null;
}
