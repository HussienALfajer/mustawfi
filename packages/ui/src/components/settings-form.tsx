import { type ReactNode, useId } from "react";
import { cx } from "./cx.ts";

/** A titled section of a settings form (`screen-patterns.md`: sections with headings on one page). */
export function FormSection({
  title,
  description,
  children,
  className,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={cx(
        "flex flex-col gap-4 border border-divider bg-surface p-5 text-text",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {description === undefined ? null : <p className="text-text-secondary">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * A settings form's actions, in a footer that stays in view while the form scrolls. It must be
 * a direct child of the scrolling box: a sticky element never leaves its parent.
 */
export function FormFooter({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cx(
        "sticky bottom-0 z-10 flex flex-wrap items-center gap-2 border-t border-divider bg-surface px-6 py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
