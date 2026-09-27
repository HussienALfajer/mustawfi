import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { cx, FOCUS_RING } from "./cx.ts";
import { ITEM_STATES, PRESSABLE } from "./interaction.ts";

export interface MenuAction<K extends string> {
  readonly id: K;
  readonly label: string;
  /** Shown before the label; decorative, the label names the action. */
  readonly icon?: ReactNode;
}

export interface MenuButtonProps<K extends string> {
  /**
   * What the button shows (the user's name and role, say): its accessible name, and the name
   * of the menu it opens.
   */
  readonly children: ReactNode;
  readonly actions: readonly MenuAction<K>[];
  readonly onAction: (id: K) => void;
  readonly className?: string;
}

/**
 * A button that opens a short list of actions (the top bar's user menu). Keyboard: Enter,
 * Space, or the down arrow opens it on the first action; the arrow keys move; Enter acts;
 * `Esc` closes it and returns focus to the button. Every action is always visible in the
 * list, never on hover only.
 */
export function MenuButton<K extends string>({
  children,
  actions,
  onAction,
  className,
}: MenuButtonProps<K>) {
  return (
    <MenuTrigger>
      <AriaButton
        className={cx(
          "flex min-h-control items-center gap-2 rounded-sm px-2 text-start text-text data-[hovered]:bg-state-hover-bg data-[pressed]:bg-state-pressed-bg",
          PRESSABLE,
          FOCUS_RING,
          className,
        )}
      >
        {children}
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </AriaButton>
      <Popover
        placement="bottom end"
        className="min-w-48 overflow-auto rounded-sm border border-divider bg-surface text-text shadow-floating"
      >
        <Menu
          items={actions}
          onAction={(key) => {
            const action = actions.find((candidate) => candidate.id === key);
            if (action !== undefined) onAction(action.id);
          }}
          className="p-1 outline-none"
        >
          {(action) => (
            <MenuItem
              id={action.id}
              textValue={action.label}
              className={cx(
                "flex items-center gap-2 rounded-sm px-pad-inline py-1.5 text-density",
                ITEM_STATES,
              )}
            >
              {action.icon === undefined ? null : (
                <span aria-hidden="true" className="text-text-secondary">
                  {action.icon}
                </span>
              )}
              {action.label}
            </MenuItem>
          )}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
