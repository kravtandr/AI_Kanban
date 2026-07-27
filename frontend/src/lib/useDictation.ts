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

export function useDictation(onText: (text: string) => void): Dictation {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);

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
      if (elapsed >= MAX_SECONDS) recorderRef.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [state]);

  const start = useCallback(async () => {
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Нет доступа к микрофону — разрешите в настройках браузера");
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
    setState("recording");
  }, []);

  const toggle = useCallback(() => {
    if (!supported) {
      setError("Диктовка требует HTTPS — откройте трекер по https://");
      return;
    }
    if (state === "transcribing") return; // повторный тап не должен рвать загрузку
    if (state === "recording") recorderRef.current?.stop();
    else void start();
  }, [supported, state, start]);

  return { supported, state, error, seconds, toggle };
}
