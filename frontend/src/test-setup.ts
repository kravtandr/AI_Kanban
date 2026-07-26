// Матчеры вида toBeInTheDocument / toHaveAttribute для компонентных тестов.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Без globals: true авто-cleanup у testing-library не регистрируется, и
// отрендеренные деревья накапливаются между тестами — запросы по роли
// начинают находить по несколько совпадений.
afterEach(cleanup);

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
