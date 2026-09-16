import { useRef, useState } from "react";
import Modal from "./Modal";

interface Props {
  taskTitle: string;
  prompt: string | null;
  pending: boolean;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

export default function AgentPromptModal({ taskTitle, prompt, pending, error, onRetry, onClose }: Props) {
  const field = useRef<HTMLTextAreaElement>(null);
  const [copyStatus, setCopyStatus] = useState("");

  const copy = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopyStatus("Скопировано");
    } catch {
      field.current?.focus();
      field.current?.select();
      setCopyStatus("Не удалось скопировать автоматически. Текст выделен — скопируйте его вручную.");
    }
  };

  return (
    <Modal title="Промпт для агента" onClose={onClose}>
      <p className="mb-3 text-sm break-words text-dim">{taskTitle}</p>
      {pending && <p role="status" className="py-6 text-sm text-ai">Генерирую промпт…</p>}
      {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
      {prompt && (
        <>
          <textarea
            ref={field}
            aria-label="Готовый промпт"
            readOnly
            value={prompt}
            className="input h-[45vh] w-full resize-y font-mono text-sm"
          />
          <p role="status" className="mt-2 text-xs text-dim">{copyStatus}</p>
        </>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onClose}>Закрыть</button>
        {error && !pending && <button type="button" className="btn-ai" onClick={onRetry}>Повторить</button>}
        {prompt && <button type="button" className="btn-ai" onClick={copy}>Копировать</button>}
      </div>
    </Modal>
  );
}
