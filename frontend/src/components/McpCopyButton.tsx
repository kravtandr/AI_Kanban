import { useState } from "react";

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    // Clipboard API requires a secure context; the portal also runs on HTTP in LAN.
  }
  const previousFocus = document.activeElement;
  const field = document.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.tabIndex = -1;
  field.style.cssText =
    "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Copy failed");
  } finally {
    field.remove();
    if (previousFocus instanceof HTMLElement)
      previousFocus.focus({ preventScroll: true });
  }
}

export default function McpCopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try {
      await copyText(value);
      setFeedback("Скопировано");
    } catch {
      setFeedback("Выделите и скопируйте текст вручную");
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="mcp-copy"
        aria-label={label}
      >
        <svg
          viewBox="0 0 20 20"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          aria-hidden="true"
        >
          <rect x="7" y="7" width="9" height="10" rx="2" />
          <path d="M12 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
        </svg>
        Копировать
      </button>
      {feedback && (
        <span role="status" className="text-xs text-mcp">
          {feedback}
        </span>
      )}
    </div>
  );
}
