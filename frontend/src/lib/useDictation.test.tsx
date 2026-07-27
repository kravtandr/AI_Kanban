import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { useDictation } from "./useDictation";

/** Управляемый двойник MediaRecorder: тест сам решает, когда придут данные
 * и когда запись остановится. */
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = () => true;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  mimeType = "audio/webm";
  state: "inactive" | "recording" = "inactive";

  constructor(
    public stream: MediaStream,
    public options?: { mimeType?: string },
  ) {
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["audio"], { type: "audio/webm" }) });
    this.onstop?.();
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
});
