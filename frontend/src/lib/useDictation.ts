import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

export type DictationState = "idle" | "recording" | "transcribing";

export interface Dictation {
  /** false — браузер не даёт записывать (чаще всего страница открыта по HTTP). */
  supported: boolean;
  state: DictationState;
  error: string | null;
  /** Длительность текущей записи для индикатора. */
  seconds: number;
  toggle: () => void;
}

/** Предел одной записи. Ограничивает и размер загрузки (бэкенд режет на
 * WHISPER_MAX_AUDIO_MB), и время ожидания расшифровки. */
const MAX_SECONDS = 120;

/** Chrome отдаёт webm/opus, Safari — mp4/aac; Whisper декодирует оба через
 * ffmpeg. Пустая строка — пусть браузер выберет сам. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function"
  );
}

function pickMimeType(): string {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported?.(type)) ?? "";
}

/** MediaRecorder.stop() кидает InvalidStateError на уже остановленном
 * рекордере. Дублирующий стоп прилетает и от 120-секундного таймера (тикает
 * каждые 250мс и может не увидеть смену состояния), и от двойного тапа по
 * кнопке — оба раза безопасно уходим в no-op. */
function stopIfActive(recorder: MediaRecorder | null): void {
  if (recorder && recorder.state !== "inactive") recorder.stop();
}

export function useDictation(onText: (text: string) => void): Dictation {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);

  // Защита от повторного входа в start(): пока getUserMedia в подвесе,
  // публичный state всё ещё "idle", и обычный быстрый двойной тап толкнёт
  // toggle() в start() второй раз. Флаг выставляется синхронно до первого
  // await, поэтому второй вызов в тот же тик уже видит true.
  const startingRef = useRef(false);
  // Размонтирование могло случиться, пока getUserMedia ещё не ответил —
  // recorderRef тогда пуст, и эффекту очистки нечего останавливать.
  const unmountedRef = useRef(false);

  // onText пересоздаётся на каждом рендере потребителя. Держим его в ref,
  // иначе обработчики MediaRecorder замкнулись бы на устаревшую версию.
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  // window трогаем только на клиенте и только один раз
  const supported = useMemo(recordingSupported, []);

  // Размонтирование во время записи (закрыли модалку) не должно оставлять
  // гореть индикатор микрофона в браузере.
  useEffect(
    () => () => {
      unmountedRef.current = true;
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (state !== "recording") return;
    setSeconds(0);
    const startedAt = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startedAt) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stopIfActive(recorderRef.current);
    }, 250);
    return () => clearInterval(timer);
  }, [state]);

  const start = useCallback(async () => {
    if (startingRef.current || recorderRef.current) return;
    startingRef.current = true;
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Нет доступа к микрофону — разрешите в настройках браузера");
      startingRef.current = false;
      return;
    }

    if (unmountedRef.current) {
      // Компонент исчез, пока пользователь решал в диалоге разрешений.
      // Рекордер уже некому будет остановить — гасим поток сразу.
      stream.getTracks().forEach((track) => track.stop());
      startingRef.current = false;
      return;
    }

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
      const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (blob.size === 0) {
        setState("idle");
        return;
      }
      setState("transcribing");
      try {
        const { text } = await api.transcribe(blob);
        if (text) onTextRef.current(text);
        else setError("Ничего не распознано");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось распознать речь");
      } finally {
        setState("idle");
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    startingRef.current = false;
    setState("recording");
  }, []);

  const toggle = useCallback(() => {
    if (!supported) {
      setError("Диктовка требует HTTPS — откройте трекер по https://");
      return;
    }
    if (state === "transcribing") return; // повторный тап не должен рвать загрузку
    if (state === "recording") stopIfActive(recorderRef.current);
    else void start();
  }, [supported, state, start]);

  return { supported, state, error, seconds, toggle };
}
