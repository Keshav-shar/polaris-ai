import type { ReactNode } from "react";

// One shape for every "nothing here yet" panel, so an empty Codex and an unwritten scroll read as
// deliberate states rather than as a broken page.
export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mystic-panel arch-border rounded-2xl p-10 text-center">
      <p className="font-serif text-lg text-astral-gold">{title}</p>
      {children === undefined ? null : (
        <div className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-slate-400">{children}</div>
      )}
      {action === undefined ? null : <div className="mt-6">{action}</div>}
    </div>
  );
}
