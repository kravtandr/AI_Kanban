import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/board", label: "задачи" },
  { to: "/expenses", label: "траты" },
];

/** Переключатель разделов в шапке. Моно-ссылки в тон кнопкам «время»/«выйти»;
 * активная подчёркнута янтарём, как остальные акценты. */
export default function NavTabs() {
  return (
    <nav aria-label="Разделы" className="flex shrink-0 items-center gap-3 font-mono text-xs">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) =>
            `border-b transition ${
              isActive ? "border-amber text-ink" : "border-transparent text-dim hover:text-ink"
            }`
          }
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
