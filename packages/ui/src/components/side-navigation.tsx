import { PanelRight } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { Button as AriaButton } from "react-aria-components";
import { cx } from "./cx.ts";
import { Kbd } from "./kbd.tsx";
import { useShortcut } from "./keyboard.ts";

/** The class names a navigation link takes; the link itself comes from the app's router. */
export const NAV_LINK_CLASS = cx(
  "group/nav relative flex h-9 items-center gap-3 rounded-md px-2 whitespace-nowrap text-text-secondary outline-none",
  "hover:bg-sunken hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring",
  "aria-[current=page]:bg-selected aria-[current=page]:font-semibold aria-[current=page]:text-text-accent",
  "aria-[current=page]:before:absolute aria-[current=page]:before:inset-y-1.5 aria-[current=page]:before:-start-2 aria-[current=page]:before:w-[3px] aria-[current=page]:before:rounded-sm aria-[current=page]:before:bg-accent",
);

export interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  /**
   * Renders the link with the router's own component, with `className` and `children`. The
   * router marks the current page with `aria-current="page"`.
   */
  readonly link: (props: { readonly className: string; readonly children: ReactNode }) => ReactNode;
}

export interface NavGroup {
  readonly id: string;
  readonly label: string;
  readonly items: readonly NavItem[];
}

export interface SideNavigationProps {
  /** The navigation landmark's name. */
  readonly label: string;
  /** The product mark, and its one-letter form for the collapsed state. */
  readonly brand: ReactNode;
  readonly collapsedBrand: ReactNode;
  /** Groups without items are not shown: an entry appears only when the user may open it. */
  readonly groups: readonly NavGroup[];
  readonly collapsed: boolean;
  readonly onCollapsedChange: (collapsed: boolean) => void;
  readonly collapseLabel: string;
  readonly expandLabel: string;
}

/** The expanded and collapsed widths agreed on the frame preview (`screen-patterns.md`). */
export const SIDE_NAVIGATION_WIDTH = { expanded: "232px", collapsed: "56px" } as const;

/**
 * The grouped side navigation on the start side (ADR-0024 frame). Collapsed, it shows icons
 * only; each label stays the link's accessible name and appears beside it on hover or focus.
 * `Ctrl+B` toggles it.
 */
export function SideNavigation({
  label,
  brand,
  collapsedBrand,
  groups,
  collapsed,
  onCollapsedChange,
  collapseLabel,
  expandLabel,
}: SideNavigationProps) {
  useShortcut({ key: "b", ctrl: true }, () => {
    onCollapsedChange(!collapsed);
  });
  const toggleLabel = collapsed ? expandLabel : collapseLabel;
  return (
    <nav
      aria-label={label}
      data-collapsed={collapsed || undefined}
      className={cx(
        "flex h-full min-w-0 flex-col border-e border-divider bg-surface",
        // Collapsed, the labels show beside the icons, outside the navigation's box.
        collapsed ? "overflow-visible" : "overflow-x-hidden overflow-y-auto",
      )}
    >
      <div className="flex min-h-14 items-center px-4">{collapsed ? collapsedBrand : brand}</div>
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <div key={group.id} role="group" aria-label={group.label} className="py-2">
            {collapsed ? (
              <div aria-hidden="true" className="mx-3 my-1 border-t border-divider" />
            ) : (
              <div aria-hidden="true" className="px-4 py-1 text-xs font-medium text-text-muted">
                {group.label}
              </div>
            )}
            <ul className="flex flex-col gap-0.5 px-2">
              {group.items.map((item) => (
                <li key={item.id}>
                  {item.link({
                    className: NAV_LINK_CLASS,
                    children: (
                      <>
                        <span aria-hidden="true" className="flex size-5 flex-none items-center">
                          {item.icon}
                        </span>
                        <span
                          className={cx(
                            collapsed &&
                              "pointer-events-none absolute start-[calc(100%+8px)] z-10 rounded-sm border border-field-border bg-surface px-2 text-sm text-text opacity-0 shadow-floating group-hover/nav:opacity-100 group-focus-visible/nav:opacity-100",
                          )}
                        >
                          {item.label}
                        </span>
                      </>
                    ),
                  })}
                </li>
              ))}
            </ul>
          </div>
        ))}
      <div className="mt-auto border-t border-divider p-2">
        <AriaButton
          aria-expanded={!collapsed}
          aria-keyshortcuts="Control+B"
          {...(collapsed ? { "aria-label": toggleLabel } : {})}
          onPress={() => {
            onCollapsedChange(!collapsed);
          }}
          className={cx(NAV_LINK_CLASS, "w-full cursor-default")}
        >
          <span aria-hidden="true" className="flex size-5 flex-none items-center">
            <PanelRight size={20} strokeWidth={1.75} />
          </span>
          {collapsed ? null : (
            <>
              <span>{toggleLabel}</span>
              <Kbd shortcut="Control+B" className="ms-auto" />
            </>
          )}
        </AriaButton>
      </div>
    </nav>
  );
}

/**
 * Whether the side navigation is collapsed, remembered on this device. Storage can be missing
 * or refuse (a private window): the navigation then starts expanded and still toggles.
 */
export function useNavigationCollapsed(
  storageKey: string,
): readonly [boolean, (next: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === "collapsed";
    } catch {
      return false;
    }
  });
  const update = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      try {
        window.localStorage.setItem(storageKey, next ? "collapsed" : "expanded");
      } catch {
        // Not remembered; the choice holds until the page reloads.
      }
    },
    [storageKey],
  );
  return [collapsed, update];
}
