import type { Project } from "../types";

export interface ProjectMenuItem {
  id: number;
  name: string;
  color: string;
  current: boolean;
}

/** Пункты меню смены проекта.
 *
 * В отличие от индекса, который уходит в LLM, Inbox здесь ЕСТЬ: вернуть
 * задачу в Inbox вручную — законное действие. Он идёт последним, остальные
 * по алфавиту — список проектов растёт, и стабильный порядок важнее свежести.
 */
export function projectMenuItems(
  projects: Project[],
  currentProjectId: number,
): ProjectMenuItem[] {
  return [...projects]
    .sort((a, b) => {
      if (a.is_inbox !== b.is_inbox) return a.is_inbox ? 1 : -1;
      return a.name.localeCompare(b.name, "ru");
    })
    .map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      current: p.id === currentProjectId,
    }));
}

/** Проект с таким именем без учёта регистра.
 *
 * Этим разрешается 409 от POST /projects: бэкенд считает имена
 * регистронезависимо, и пользователь, набравший существующее имя, хотел
 * попасть в этот проект, а не увидеть ошибку.
 */
export function findProjectByName(projects: Project[], name: string): Project | undefined {
  const needle = name.trim().toLowerCase();
  return projects.find((p) => p.name.toLowerCase() === needle);
}
