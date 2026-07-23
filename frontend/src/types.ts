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
}

export interface TaskDraft {
  title: string;
  description: string;
  project: string | null;
  priority: Priority;
  tags: string[];
  due_date: string | null;
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
