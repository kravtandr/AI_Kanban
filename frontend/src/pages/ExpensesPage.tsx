import NavTabs from "../components/NavTabs";

export default function ExpensesPage() {
  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-edge/70 bg-surface">
        <div className="flex items-center gap-3 p-3 md:px-5">
          <h1 className="shrink-0 font-mono text-base font-medium">
            <span className="caret">tasktracker</span>
          </h1>
          <NavTabs />
        </div>
      </header>
    </div>
  );
}
