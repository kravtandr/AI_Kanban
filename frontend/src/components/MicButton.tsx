import type { Dictation } from "../lib/useDictation";

interface Props {
  dictation: Dictation;
  /** Что диктуем — попадает в подпись: «Надиктовать задачу», «Надиктовать описание». */
  target: string;
  /** Компактный вариант для поля формы; по умолчанию — размер командной строки. */
  compact?: boolean;
}

/** Кнопка диктовки. Состояние и переключение приходят от useDictation —
 * компонент только рисует. Недоступность записи он не скрывает: причину
 * объясняет подсказка рядом, а не молчаливо отсутствующая кнопка. */
export default function MicButton({ dictation, target, compact = false }: Props) {
  const label =
    dictation.state === "recording"
      ? "Остановить диктовку"
      : dictation.state === "transcribing"
        ? "Распознаю речь"
        : `Надиктовать ${target}`;

  return (
    <button
      type="button"
      onClick={dictation.toggle}
      disabled={dictation.state === "transcribing"}
      aria-label={label}
      title={label}
      className={`btn-icon disabled:opacity-40 ${
        compact ? "h-8 w-8" : "h-11 w-11 md:h-10 md:w-10"
      } ${dictation.state === "recording" ? "mic-live" : ""}`}
    >
      <svg
        aria-hidden="true"
        width={compact ? 15 : 17}
        height={compact ? 15 : 17}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10a7 7 0 0 0 14 0" />
        <line x1="12" y1="19" x2="12" y2="22" />
      </svg>
    </button>
  );
}
