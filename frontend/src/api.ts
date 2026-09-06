import type {
  Analytics,
  DraftResponse,
  Expense,
  ExpenseDraftResponse,
  ExpenseSummary,
  Insights,
  Project,
  Task,
  User,
} from "./types";

const BASE = "/api/v1";

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Content-Type для FormData обязан выставлять браузер: ему нужно
  // дописать boundary, которого у нас нет.
  const isForm = options.body instanceof FormData;
  const response = await fetch(`${BASE}${path}`, {
    credentials: "same-origin",
    headers: options.body && !isForm ? { "Content-Type": "application/json" } : undefined,
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
  patchTask: (
    id: number,
    body: Partial<Task> & { clear_due_date?: boolean; clear_estimate?: boolean },
  ) => request<Task>(`/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  moveTask: (id: number, status: string) =>
    request<Task>(`/tasks/${id}/move`, { method: "POST", body: JSON.stringify({ status }) }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: "DELETE" }),

  draft: (text: string) =>
    request<DraftResponse>("/ai/draft", { method: "POST", body: JSON.stringify({ text }) }),
  enhance: (taskId: number) =>
    request<DraftResponse>(`/ai/enhance/${taskId}`, { method: "POST" }),
  transcribe: (blob: Blob) => {
    const form = new FormData();
    // Имя файла нужно Whisper для выбора декодера: Safari отдаёт mp4, Chrome — webm.
    form.append("file", blob, blob.type.includes("mp4") ? "audio.mp4" : "audio.webm");
    return request<{ text: string }>("/ai/transcribe", { method: "POST", body: form });
  },
  analytics: (days: number) => request<Analytics>(`/analytics?days=${days}`),
  // POST, а не GET: инсайты тратят токены и обязаны быть явным действием,
  // которое react-query не пре-фетчит (NFR-6, §10.1).
  insights: (days: number) =>
    request<Insights>("/ai/insights", { method: "POST", body: JSON.stringify({ days }) }),

  expenses: (params: URLSearchParams) => request<Expense[]>(`/expenses?${params.toString()}`),
  createExpense: (body: Partial<Expense> & { title: string; amount: number; ai_meta?: unknown }) =>
    request<Expense>("/expenses", { method: "POST", body: JSON.stringify(body) }),
  patchExpense: (id: number, body: Partial<Expense> & { clear_period?: boolean }) =>
    request<Expense>(`/expenses/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  moveExpense: (id: number, status: string, sort_order?: number) =>
    request<Expense>(`/expenses/${id}/move`, {
      method: "POST",
      body: JSON.stringify({ status, sort_order }),
    }),
  deleteExpense: (id: number) => request<void>(`/expenses/${id}`, { method: "DELETE" }),
  expenseSummary: () => request<ExpenseSummary>("/expenses/summary"),
  draftExpense: (text: string) =>
    request<ExpenseDraftResponse>("/ai/draft-expense", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
};
