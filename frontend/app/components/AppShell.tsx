"use client";

import ThemeProvider from "./ThemeProvider";
import ThemeToggle from "./ThemeToggle";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <header className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4 backdrop-blur-xl border-b bg-[var(--bg)]/80 border-[var(--border)]">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[var(--text-primary)]/80" />
          <div className="text-sm font-bold tracking-[0.3em] uppercase text-[var(--text-primary)]">
            SpectraStruct
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] text-[var(--text-muted)] tracking-[0.15em] uppercase">
            DiamondHacks 2026
          </span>
          <ThemeToggle />
        </div>
      </header>
      <main className="flex-1 pt-16">{children}</main>
    </ThemeProvider>
  );
}
