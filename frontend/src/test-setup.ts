// Матчеры вида toBeInTheDocument / toHaveAttribute для компонентных тестов.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Без globals: true авто-cleanup у testing-library не регистрируется, и
// отрендеренные деревья накапливаются между тестами — запросы по роли
// начинают находить по несколько совпадений.
afterEach(cleanup);

// jsdom не реализует PointerEvent. Без него fireEvent.pointerDown создаёт
// generic Event и молча теряет pointerType с координатами — тесты жестов
// «проходили» бы, ничего не проверяя. Подменяем наследником MouseEvent,
// который эти поля доносит.
// Обращаемся через globalThis, а не через window: проверка `"PointerEvent" in
// window` сузила бы тип window до never и уронила typecheck.
const dom = globalThis as unknown as {
  MouseEvent: typeof MouseEvent;
  PointerEvent?: unknown;
};
if (typeof window !== "undefined" && dom.PointerEvent === undefined) {
  class PointerEventPolyfill extends dom.MouseEvent {
    readonly pointerId: number;
    readonly pointerType: string;

    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? "";
    }
  }
  dom.PointerEvent = PointerEventPolyfill;
}

// jsdom не реализует matchMedia, а компоненты по нему решают, ставить ли
// автофокус на десктопе (Modal, LoginPage). Отвечаем «не десктоп»: это
// консервативнее — тест, зависящий от автофокуса, обязан выставить его сам.
// Проверка typeof обязательна: setupFiles применяется и к .test.ts, которые
// идут в окружении node, где window не существует вовсе.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
