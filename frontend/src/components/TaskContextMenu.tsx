import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { projectMenuItems } from "../lib/projectMenu";
import type { Project } from "../types";

interface Props {
  projects: Project[];
  currentProjectId: number;
  /** Точка вызова: курсор на десктопе. На мобильном не используется — там лоток. */
  at: { x: number; y: number };
  onPick: (projectId: number) => void;
  onCreateNew: () => void;
  onClose: () => void;
}

const MENU_WIDTH = 240;
const MENU_MAX_HEIGHT = 320;

/** Меню смены проекта у задачи.
 *
 * Через portal под body: у шапки доски backdrop-filter, который создаёт
 * containing block для fixed-элементов и обрезал бы меню (та же причина,
 * что у Modal).
 *
 * На десктопе — поповер у курсора, на мобильном — лоток снизу: привязка к
 * «курсору» на экране 390 px бессмысленна.
 */
export default function TaskContextMenu({
  projects,
  currentProjectId,
  at,
  onPick,
  onCreateNew,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const items = projectMenuItems(projects, currentProjectId);

  useEffect(() => {
    // Фокус вернём туда, откуда меню вызвали: иначе после закрытия он падает
    // на body и клавиатурный пользователь теряет место на доске.
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const nodesNow = () =>
      Array.from(ref.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
        return;
      }
      const nodes = nodesNow();
      if (nodes.length === 0) return;
      const index = nodes.indexOf(document.activeElement as HTMLElement);

      // Ловушка Tab: меню перекрывает доску, и Tab без неё уводил бы фокус на
      // элементы под ним — aria-роль menu без ловушки это обещание без покрытия.
      if (event.key === "Tab") {
        event.preventDefault();
        const delta = event.shiftKey ? -1 : 1;
        nodes[(index + delta + nodes.length) % nodes.length]?.focus();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      // Фокус кольцом: с последнего вниз — на первый.
      nodes[(index + delta + nodes.length) % nodes.length]?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Зажим по вьюпорту: у нижнего или правого края меню иначе уезжает за экран.
  const isWide = typeof window !== "undefined" && window.innerWidth >= 640;
  const left = Math.min(at.x, Math.max(0, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.min(at.y, Math.max(0, window.innerHeight - MENU_MAX_HEIGHT - 8));

  return createPortal(
    <>
      <div className="fixed inset-0 z-40" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        aria-label="Проект задачи"
        className="fixed inset-x-0 bottom-0 z-50 max-h-[70vh] overflow-y-auto rounded-t-xl border border-edge bg-card p-1.5 shadow-2xl sm:inset-x-auto sm:bottom-auto sm:w-60 sm:rounded-lg"
        style={isWide ? { left, top, maxHeight: MENU_MAX_HEIGHT } : undefined}
      >
        <p className="eyebrow px-2 py-1.5">Проект</p>
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitemradio"
            aria-checked={item.current}
            onClick={() => {
              // Выбор текущего проекта — не изменение: не шлём лишний PATCH.
              if (!item.current) onPick(item.id);
              onClose();
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-edge/40"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color }}
            />
            <span className="truncate">{item.name}</span>
            {item.current && (
              <span aria-hidden="true" className="ml-auto font-mono text-xs text-amber">
                ✓
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          role="menuitem"
          onClick={onCreateNew}
          className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-edge/60 px-2 py-2 text-left text-sm text-dim hover:bg-edge/40 hover:text-ink"
        >
          <span aria-hidden="true" className="font-mono">
            +
          </span>
          Новый проект…
        </button>
      </div>
    </>,
    document.body,
  );
}
