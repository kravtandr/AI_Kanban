import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  /** Основное действие модалки — вызывается по Cmd/Ctrl+Enter. */
  onSubmit?: () => void;
  /** Видимый заголовок. Он же — доступное имя диалога через aria-labelledby,
   * поэтому имя не может разойтись с тем, что видит зрячий пользователь. */
  title: string;
  /** Слот справа от заголовка (например, кнопка «Оформить» через AI). */
  headerAction?: ReactNode;
  children: ReactNode;
}

// Модалки могут наслаиваться (например, черновик поверх лотка QuickAdd),
// поэтому scroll-lock считаем модульным счётчиком (снимает последний),
// а Esc обрабатывает только верхняя модалка из стека.
let scrollLocks = 0;
let prevBodyOverflow = "";
const modalStack: symbol[] = [];

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Portal-based modal: rendered under document.body so ancestor styles
 * (backdrop-filter on the header creates a containing block for fixed
 * elements) can never clip or offset it.
 * Клавиатура: Esc закрывает, Cmd/Ctrl+Enter — основное действие, Tab
 * заперт внутри панели (aria-modal без ловушки — обещание без покрытия). */
export default function Modal({ onClose, onSubmit, title, headerAction, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(Symbol("modal"));
  const headingId = useId();
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

  // Возвращаем фокус туда, откуда модалку открыли: иначе после закрытия он
  // падает на <body> и Tab начинает обход страницы заново.
  useEffect(() => {
    const restoreTo = document.activeElement as HTMLElement | null;
    return () => restoreTo?.focus?.();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Хоткеи достаются только верхней модалке
      if (modalStack[modalStack.length - 1] !== idRef.current) return;
      if (event.key === "Escape") {
        if (event.isComposing) return; // Esc во время IME-набора — не закрытие
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onSubmit?.();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (nodes.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      // Фокус утёк за пределы панели — забираем обратно
      if (!panel.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
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
    // выехавшая клавиатура закрыла бы половину bottom-sheet, поэтому там
    // фокусируем саму панель: фокус всё равно обязан быть внутри ловушки.
    if (window.matchMedia("(min-width: 768px)").matches) {
      const field = panelRef.current?.querySelector<HTMLElement>("input, textarea, select");
      if (field) {
        field.focus();
        return;
      }
    }
    panelRef.current?.focus();
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
        aria-labelledby={headingId}
        tabIndex={-1}
        className="max-h-[92vh] w-full overflow-y-auto overscroll-contain rounded-t-2xl border border-edge bg-surface p-5 shadow-2xl md:max-w-lg md:rounded-2xl"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={headingId} className="text-lg font-semibold text-balance">
            {title}
          </h2>
          {headerAction}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
