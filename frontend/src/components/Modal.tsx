import type { ReactNode } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  children: ReactNode;
}

/** Portal-based modal: rendered under document.body so ancestor styles
 * (backdrop-filter on the header creates a containing block for fixed
 * elements) can never clip or offset it. */
export default function Modal({ onClose, children }: Props) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center md:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 md:max-w-lg md:rounded-2xl dark:bg-slate-900"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
