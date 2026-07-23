import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  /** Основное действие модалки — вызывается по Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  children: ReactNode;
}

// Модалки могут наслаиваться (например, черновик поверх лотка QuickAdd),
// поэтому scroll-lock считаем модульным счётчиком (снимает последний),
// а Esc обрабатывает только верхняя модалка из стека.
let scrollLocks = 0;
let prevBodyOverflow = "";
const modalStack: symbol[] = [];

/** Portal-based modal: rendered under document.body so ancestor styles
 * (backdrop-filter on the header creates a containing block for fixed
 * elements) can never clip or offset it.
 * Клавиатура: Esc закрывает, Cmd/Ctrl+Enter — основное действие. */
export default function Modal({ onClose, onSubmit, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Symbol("modal"));
  // Закрываем по клику на подложку, только если и pointerdown, и pointerup
  // случились на ней самой: выделение текста в поле с отпусканием мыши за
  // модалкой не должно рождать закрытие (и терять введённое).
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    const id = idRef.current;
    modalStack.push(id);
    return () => {
      const index = modalStack.indexOf(id);
      if (index !== -1) modalStack.splice(index, 1);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Хоткеи достаются только верхней модалке
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      if (event.key === "Escape") {
        if (event.isComposing) return; // Esc во время IME-набора — не закрытие
        event.preventDefault();
        onClose();
      } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSubmit?.();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onSubmit]);

  useEffect(() => {
    // Фон под модалкой не должен скроллиться (актуально для bottom-sheet
    // на мобильном); overflow ставит первая модалка, снимает последняя
    scrollLocks += 1;
    if (scrollLocks === 1) {
      prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = prevBodyOverflow;
    };
  }, []);

  useEffect(() => {
    // На десктопе сразу ставим курсор в первое поле; на мобильном не надо —
    // выехавшая клавиатура закрыла бы половину bottom-sheet
    if (window.matchMedia("(min-width: 768px)").matches) {
      panelRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    }
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-night/70 backdrop-blur-[2px] md:items-center md:p-4"
      onPointerDown={(e) => {
        pressedOnOverlay.current = e.target === e.currentTarget;
      }}
      onPointerUp={(e) => {
        const shouldClose = pressedOnOverlay.current && e.target === e.currentTarget;
        pressedOnOverlay.current = false;
        if (shouldClose) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl border border-edge bg-surface p-5 shadow-2xl md:max-w-lg md:rounded-2xl"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
