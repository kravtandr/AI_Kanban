/** Минимальная обёртка над Web Speech API: тип в DOM-либе TS отсутствует,
 * поэтому описываем ровно то, что используем. Кнопка микрофона появляется
 * только там, где браузер API реально поддерживает. */
export interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

export interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> {
  /** true — сегмент распознан окончательно; false — промежуточный (interim). */
  isFinal: boolean;
}

export interface SpeechRecognitionErrorEventLike {
  /** Код ошибки Web Speech API: "not-allowed", "service-not-allowed", "no-speech", … */
  error?: string;
}

export interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: { results: ArrayLike<SpeechRecognitionResultLike> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  start(): void;
  stop(): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as SpeechRecognitionCtor | null;
}
