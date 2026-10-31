import type { ReactNode } from "react";

// One shape for every "nothing here yet" panel, so an empty library and an unwritten lesson read as
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
    <div className="parchment-card rounded-2xl p-10 text-center">
      <p className="font-serif text-xl font-bold text-ink">{title}</p>
      {children === undefined ? null : (
        <div className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-subtle">{children}</div>
      )}
      {action === undefined ? null : <div className="mt-6">{action}</div>}
    </div>
  );
}
