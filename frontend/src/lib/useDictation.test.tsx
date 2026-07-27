import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useDictation } from "./useDictation";

/** Управляемый двойник MediaRecorder: тест сам решает, когда придут данные
 * и когда запись остановится.
 *
 * Настоящий MediaRecorder меняет state на "inactive" синхронно внутри
 * stop(), но событие stop (и, соответственно, вызов onstop) прилетает позже,
 * отдельной задачей — и повторный stop() на уже неактивном рекордере кидает
 * InvalidStateError. Двойник намеренно воспроизводит именно эту задержку:
 * без неё баги двойного stop() и гонки с размонтированием непроверяемы. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  // Управляют исключениями из конструктора и start() для проверки
  // exception-safety — по умолчанию выключены, не влияют на прочие тесты.
  static throwOnConstruct = false;
  static throwOnStart = false;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";

  constructor(
    public stream: MediaStream,
    public options?: { mimeType?: string },
  ) {
    if (FakeMediaRecorder.throwOnConstruct) {
      throw new DOMException("mimeType не поддерживается", "NotSupportedError");
    }
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    if (FakeMediaRecorder.throwOnStart) {
      throw new DOMException("трек уже остановлен", "InvalidStateError");
    }
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") {
      throw new DOMException("The MediaRecorder is inactive", "InvalidStateError");
    }
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
      this.onstop?.();
    });
  }
}

const stopTrack = vi.fn();

function mockMedia(getUserMedia: () => Promise<MediaStream>) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  (window as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeMediaRecorder;
}

function fakeStream(): MediaStream {
  return { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
}

function Harness({ onText }: { onText: (text: string) => void }) {
  const d = useDictation(onText);
  return (
    <div>
      <button onClick={d.toggle}>микрофон</button>
      <span data-testid="state">{d.state}</span>
      <span data-testid="supported">{String(d.supported)}</span>
      <span data-testid="error">{d.error ?? ""}</span>
    </div>
  );
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported = () => true;
  FakeMediaRecorder.throwOnConstruct = false;
  FakeMediaRecorder.throwOnStart = false;
  stopTrack.mockClear();
  mockMedia(() => Promise.resolve(fakeStream()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useDictation", () => {
  it("проходит путь запись → расшифровка → текст", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "купить молоко" });
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("state")).toHaveTextContent("recording");

    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(onText).toHaveBeenCalledWith("купить молоко");
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("отпускает микрофон после остановки", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "ок" });
    render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));
    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(stopTrack).toHaveBeenCalled();
  });

  it("объясняет отказ в доступе к микрофону", async () => {
    mockMedia(() => Promise.reject(new Error("NotAllowedError")));
    render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("error")).toHaveTextContent(/микрофон/i);
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("показывает ошибку сервера и не зовёт onText", async () => {
    vi.spyOn(api, "transcribe").mockRejectedValue(new Error("Сервис распознавания недоступен"));
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await userEvent.click(screen.getByRole("button"));
    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(screen.getByTestId("error")).toHaveTextContent(/недоступен/i);
    expect(onText).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("сообщает о тишине вместо вставки пустой строки", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "" });
    const onText = vi.fn();
    render(<Harness onText={onText} />);

    await userEvent.click(screen.getByRole("button"));
    await act(async () => {
      FakeMediaRecorder.instances[0].stop();
    });

    expect(onText).not.toHaveBeenCalled();
    expect(screen.getByTestId("error")).toHaveTextContent(/не распознано/i);
  });

  it("без API записи не поддерживается и объясняет причину", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    render(<Harness onText={vi.fn()} />);

    expect(screen.getByTestId("supported")).toHaveTextContent("false");

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("error")).toHaveTextContent(/https/i);
  });

  it("два быстрых тапа во время ожидания разрешения создают только один рекордер", async () => {
    let resolveGetUserMedia: (stream: MediaStream) => void = () => {};
    const pending = new Promise<MediaStream>((resolve) => {
      resolveGetUserMedia = resolve;
    });
    const getUserMedia = vi.fn(() => pending);
    mockMedia(getUserMedia);
    render(<Harness onText={vi.fn()} />);

    const button = screen.getByRole("button");
    // Без await: обе клика попадают в один и тот же синхронный тик, пока
    // getUserMedia ещё не ответил — это и есть двойной тап.
    fireEvent.click(button);
    fireEvent.click(button);

    await act(async () => {
      resolveGetUserMedia(fakeStream());
      await pending;
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(stopTrack).not.toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("recording");
  });

  it("размонтирование во время ожидания разрешения гасит поток и не создаёт рекордер", async () => {
    let resolveGetUserMedia: (stream: MediaStream) => void = () => {};
    const pending = new Promise<MediaStream>((resolve) => {
      resolveGetUserMedia = resolve;
    });
    mockMedia(() => pending);
    const { unmount } = render(<Harness onText={vi.fn()} />);

    fireEvent.click(screen.getByRole("button"));
    unmount();

    await act(async () => {
      resolveGetUserMedia(fakeStream());
      await pending;
    });

    expect(stopTrack).toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);
  });

  it("размонтирование во время записи гасит микрофон", async () => {
    const { unmount } = render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));
    expect(screen.getByTestId("state")).toHaveTextContent("recording");

    unmount();

    expect(stopTrack).toHaveBeenCalled();
  });

  it("останавливает запись саму через 120 секунд", async () => {
    vi.useFakeTimers();
    try {
      vi.spyOn(api, "transcribe").mockResolvedValue({ text: "стоп по таймеру" });
      render(<Harness onText={vi.fn()} />);

      // fireEvent вместо userEvent: клик синхронный, не зависит от реальных
      // таймеров user-event, которые под fake timers подвисают.
      fireEvent.click(screen.getByRole("button"));
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(screen.getByTestId("state")).toHaveTextContent("recording");

      await act(async () => {
        await vi.advanceTimersByTimeAsync(120_000);
      });

      expect(FakeMediaRecorder.instances[0].state).toBe("inactive");
      expect(screen.getByTestId("state")).toHaveTextContent("idle");
    } finally {
      vi.useRealTimers();
    }
  });

  it("повторный стоп подряд не бросает исключение", async () => {
    vi.spyOn(api, "transcribe").mockResolvedValue({ text: "ок" });
    render(<Harness onText={vi.fn()} />);

    const button = screen.getByRole("button");
    await userEvent.click(button);
    expect(screen.getByTestId("state")).toHaveTextContent("recording");

    // Оба клика — в одном синхронном тике, как и настоящий двойной тап:
    // первый останавливает рекордер, второй попадает на уже "inactive".
    expect(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    }).not.toThrow();

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByTestId("state")).toHaveTextContent("idle");
  });

  it("конструктор MediaRecorder бросает исключение — отпускает поток и не блокирует повторный запуск", async () => {
    FakeMediaRecorder.throwOnConstruct = true;
    render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("error")).toHaveTextContent(/не удалось начать запись/i);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    // Флаг "идёт запуск" должен быть снят — иначе toggle() тут просто
    // вернулся бы, ничего не сделав, и кнопка осталась бы мёртвой.
    FakeMediaRecorder.throwOnConstruct = false;
    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("state")).toHaveTextContent("recording");
    expect(FakeMediaRecorder.instances).toHaveLength(1);
  });

  it("recorder.start() бросает исключение — отпускает поток и не блокирует повторный запуск", async () => {
    FakeMediaRecorder.throwOnStart = true;
    render(<Harness onText={vi.fn()} />);

    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("error")).toHaveTextContent(/не удалось начать запись/i);
    expect(stopTrack).toHaveBeenCalled();
    expect(screen.getByTestId("state")).toHaveTextContent("idle");

    // Как и выше — startingRef и recorderRef должны быть сброшены, иначе
    // повторный тап по кнопке молча не сработает.
    FakeMediaRecorder.throwOnStart = false;
    await userEvent.click(screen.getByRole("button"));

    expect(screen.getByTestId("state")).toHaveTextContent("recording");
  });

  it("pickMimeType() отдаёт пустую строку, когда ни один тип не поддерживается", async () => {
    const original = FakeMediaRecorder.isTypeSupported;
    FakeMediaRecorder.isTypeSupported = () => false;
    try {
      render(<Harness onText={vi.fn()} />);

      await userEvent.click(screen.getByRole("button"));

      expect(screen.getByTestId("state")).toHaveTextContent("recording");
      // mimeType не выбран — конструктору передан undefined вместо { mimeType }.
      expect(FakeMediaRecorder.instances[0].options).toBeUndefined();
    } finally {
      FakeMediaRecorder.isTypeSupported = original;
    }
  });
});
