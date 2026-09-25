import { X } from "lucide-react";
import { type ReactNode, type Ref, useId } from "react";
import { Button as AriaButton } from "react-aria-components";
import { cx, FOCUS_RING } from "./cx.ts";

export interface SidePanelProps {
  readonly title: ReactNode;
  /** The close button's name; `Esc` anywhere in the panel closes it too. */
  readonly closeLabel: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  /** The panel's actions (Save, Archive…), in a footer that stays in view. */
  readonly footer?: ReactNode;
  readonly panelRef?: Ref<HTMLElement>;
  readonly className?: string;
}

/**
 * A record's details beside its list, never a modal (`screen-patterns.md`): 400 px on the end
 * side, the list narrowing next to it. A labelled region; `Esc` closes it.
 */
export function SidePanel({
  title,
  closeLabel,
  onClose,
  children,
  footer,
  panelRef,
  className,
}: SidePanelProps) {
  const titleId = useId();
  return (
    <aside
      ref={panelRef}
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
      className={cx(
        "flex w-[400px] max-w-full flex-none flex-col border-s border-divider bg-surface text-text",
        className,
      )}
    >
      <div className="flex min-h-14 items-center gap-2 border-b border-divider px-4">
        <h2 id={titleId} className="flex-1 truncate text-lg font-semibold">
          {title}
        </h2>
        <AriaButton
          aria-label={closeLabel}
          aria-keyshortcuts="Escape"
          onPress={onClose}
          className={cx(
            "flex size-9 flex-none cursor-default items-center justify-center rounded-md text-text-secondary data-[hovered]:bg-sunken",
            FOCUS_RING,
          )}
        >
          <X aria-hidden="true" size={18} strokeWidth={1.75} />
        </AriaButton>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4">{children}</div>
      {footer === undefined ? null : (
        <div className="flex items-center gap-2 border-t border-divider px-4 py-3">{footer}</div>
      )}
    </aside>
  );
}
