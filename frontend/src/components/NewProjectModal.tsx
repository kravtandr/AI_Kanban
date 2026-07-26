import { useId, useRef, useState } from "react";
import Modal from "./Modal";

interface Props {
  /** Бросает — сообщение показывается у поля, модалка остаётся открытой. */
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Создание проекта на ходу: спрашиваем только имя.
 *
 * Описание остаётся пустым осознанно — его допишет AI при первой задаче,
 * которую в этот проект смаршрутизирует (ветка backfill в resolve_project_id).
 * Два поля вместо одного удлинили бы путь «быстро завести проект».
 */
export default function NewProjectModal({ onCreate, onClose }: Props) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const submit = async () => {
    if (busy) return;
    const trimmed = name.trim();
    // Кнопка остаётся активной: молчаливый disabled не объясняет, что не так.
    if (!trimmed) {
      setError("Введите название проекта");
      inputRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать проект");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Новый проект" onClose={onClose} onSubmit={submit}>
      <div className="space-y-4">
        <label className="block">
          <span className="eyebrow">Название</span>
          <input
            ref={inputRef}
            name="name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="input"
          />
          {error && (
            <span id={errorId} className="mt-1 block text-xs text-danger">
              {error}
            </span>
          )}
        </label>
        <p className="text-xs text-dim">
          Описание допишет AI, когда в проект попадёт первая задача.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn-ghost">
            Отмена
          </button>
          <button type="button" onClick={submit} className="btn-primary">
            {busy ? "Создаём…" : "Создать"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
