// Матчеры вида toBeInTheDocument / toHaveAttribute для компонентных тестов.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Без globals: true авто-cleanup у testing-library не регистрируется, и
// отрендеренные деревья накапливаются между тестами — запросы по роли
// начинают находить по несколько совпадений.
afterEach(cleanup);
