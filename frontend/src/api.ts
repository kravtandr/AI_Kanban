import type { DraftResponse, Project, Task, User } from "./types";

const BASE = "/api/v1";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    ...options,
  });
  if (response.status === 401 && !window.location.pathname.startsWith("/login")) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.assign(`/login?next=${next}`);
    throw new ApiError(401, "Не авторизован");
  }
  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const body = await response.json();
      message = body?.detail?.message ?? body?.error?.message ?? message;
    } catch {
      /* keep default */
    }
    throw new ApiError(response.status, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}

export const api = {
  login: (username: string, password: string) =>
    request<User>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<{ ok: boolean }>("/auth/logout", { method: "POST" }),
  me: () => request<User>("/auth/me"),

  projects: () => request<Project[]>("/projects"),
  createProject: (body: { name: string; color?: string }) =>
    request<Project>("/projects", { method: "POST", body: JSON.stringify(body) }),

  tasks: (params: URLSearchParams) => request<Task[]>(`/tasks?${params.toString()}`),
  createTask: (body: Partial<Task> & { title: string; ai_meta?: unknown }) =>
    request<Task>("/tasks", { method: "POST", body: JSON.stringify(body) }),
  patchTask: (id: number, body: Partial<Task> & { clear_due_date?: boolean }) =>
    request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  moveTask: (id: number, status: string) =>
    request<Task>(`/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  draft: (text: string) =>
    request<DraftResponse>("/ai/draft", { method: "POST", body: JSON.stringify({ text }) }),
  enhance: (taskId: number) =>
    request<DraftResponse>(`/ai/enhance/${taskId}`, { method: "POST" }),
};
