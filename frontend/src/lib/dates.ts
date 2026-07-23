export function isOverdue(dueDate: string | null, status: string, today = new Date()): boolean {
  if (!dueDate || status === "done") return false;
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d, 23, 59, 59);
  return due.getTime() < today.getTime();
}

export function formatDue(dueDate: string | null): string {
  if (!dueDate) return "";
  const [y, m, d] = dueDate.split("-").map(Number);
  const due = new Date(y, m - 1, d);
  const now = new Date();
  const sameYear = due.getFullYear() === now.getFullYear();
  return due.toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  });
}
