import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";

/** Реальный fetch не трогаем — только двойник на globalThis. */
function mockFetchOk(body: unknown = { text: "ок" }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("api.transcribe", () => {
  it("шлёт FormData без явного Content-Type — браузер сам допишет boundary", async () => {
    const fetchMock = mockFetchOk();
    const blob = new Blob(["audio"], { type: "audio/webm" });

    await api.transcribe(blob);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.headers).toBeUndefined();
  });

  it("кладёт запись в поле file с именем audio.webm для webm-блоба", async () => {
    const fetchMock = mockFetchOk();
    const blob = new Blob(["audio"], { type: "audio/webm;codecs=opus" });

    await api.transcribe(blob);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = options.body as FormData;
    const entry = form.get("file");
    expect(entry).toBeInstanceOf(File);
    expect((entry as File).name).toBe("audio.webm");
  });

  it("кладёт запись в поле file с именем audio.mp4 для mp4-блоба (Safari)", async () => {
    const fetchMock = mockFetchOk();
    const blob = new Blob(["audio"], { type: "audio/mp4" });

    await api.transcribe(blob);

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const form = options.body as FormData;
    const entry = form.get("file");
    expect(entry).toBeInstanceOf(File);
    expect((entry as File).name).toBe("audio.mp4");
  });

  it("возвращает распознанный текст из ответа сервера", async () => {
    mockFetchOk({ text: "купить молоко" });
    const blob = new Blob(["audio"], { type: "audio/webm" });

    const result = await api.transcribe(blob);

    expect(result).toEqual({ text: "купить молоко" });
  });
});
