import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";

export type DictationState = "idle" | "recording" | "transcribing";

export interface Dictation {
  /** false — браузер не даёт записывать (чаще всего страница открыта по HTTP). */
  supported: boolean;
  state: DictationState;
  error: string | null;
  /** Информационное сообщение вне канала ошибок (например, «ничего не
   * распознано» — тишина это не сбой). Рендерится тем же приглушённым
   * стилем, что и счётчик записи. */
  notice: string | null;
  /** Длительность текущей записи для индикатора. */
  seconds: number;
  toggle: () => void;
}

/** Дописывает расшифровку к уже набранному тексту. Общая для QuickAdd и
 * TaskForm: пустое поле или поле из одних пробелов не должно оставлять
 * пробел перед вставленным текстом. */
export function appendTranscript(existing: string, transcript: string): string {
  return existing.trim() ? `${existing.trimEnd()} ${transcript}` : transcript;
}

/** Предел одной записи. Ограничивает и размер загрузки (бэкенд режет на
 * WHISPER_MAX_AUDIO_MB), и время ожидания расшифровки. */
const MAX_SECONDS = 120;

/** Chrome отдаёт webm/opus, Safari — mp4/aac; Whisper декодирует оба через
 * ffmpeg. Пустая строка — пусть браузер выберет сам. */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

function recordingSupported(): boolean {
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
  const [notice, setNotice] = useState<string | null>(null);
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
  //
  // Сброс в начале тела эффекта обязателен: React 18 StrictMode в dev
  // монтирует эффекты дважды (setup → cleanup → setup), и без сброса
  // unmountedRef застрял бы в true после первого прохода — start() тогда
  // всегда уходил бы в ветку «компонент размонтирован» и диктовка была бы
  // мертва весь dev-сеанс, хотя в проде такой двойной прогон не происходит.
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
      recorderRef.current = null;
    };
  }, []);

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
    setNotice(null);
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

    // Конструктор MediaRecorder может бросить NotSupportedError, даже если
    // isTypeSupported() перед этим вернул true (известная особенность
    // некоторых браузеров), а start() — если трек оборвался между ответом
    // getUserMedia и этим местом (устройство отключили, разрешение отозвали
    // на лету). Оба случая гасим одинаково: отпускаем уже захваченный поток,
    // снимаем флаг "идёт запуск" и показываем ошибку — иначе startingRef
    // остался бы true навсегда, и кнопка микрофона умерла бы молча.
    const mimeType = pickMimeType();
    const chunks: Blob[] = [];
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

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
          else setNotice("Ничего не распознано");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Не удалось распознать речь");
        } finally {
          setState("idle");
        }
      };

      recorderRef.current = recorder;
      recorder.start();
    } catch {
      recorderRef.current = null;
      stream.getTracks().forEach((track) => track.stop());
      startingRef.current = false;
      setError("Не удалось начать запись — попробуйте ещё раз");
      return;
    }

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

  return { supported, state, error, notice, seconds, toggle };
}
