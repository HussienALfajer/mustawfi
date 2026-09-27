import { Button } from "@mustawfi/ui";
import { useNavigate } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SHELL_NAMESPACE } from "./messages.ts";
import type { NavPath } from "./screens.ts";

export interface ScreenNotAllowedProps {
  /** The screen's title key (`pages.…`). */
  readonly title: `pages.${string}`;
  /** Where the user starts (`startScreen`), and its title key. */
  readonly start: { readonly to: NavPath; readonly title: `pages.${string}` };
}

/**
 * A screen opened by its address that the user's role does not allow (notice pattern,
 * `screen-patterns.md`): in place of the screen, the reason and the one way on, to where the user
 * starts, with the focus. The navigation never offers it; the server refuses it too
 * (`core-foundation` rule 17).
 */
export function ScreenNotAllowed({ title, start }: ScreenNotAllowedProps) {
  const { t } = useTranslation(SHELL_NAMESPACE);
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <section
        aria-labelledby="screen-not-allowed-title"
        className="flex max-w-md flex-col gap-4 rounded-md border border-divider bg-surface p-6"
      >
        <ShieldOff aria-hidden="true" size={32} strokeWidth={1.75} className="text-text-negative" />
        <h2 id="screen-not-allowed-title" className="text-xl font-bold text-text">
          {t("notAllowed.title", { screen: t(title) })}
        </h2>
        <p className="text-text">{t("notAllowed.body")}</p>
        <div>
          <Button
            autoFocus
            onPress={() => {
              void navigate({ to: start.to });
            }}
          >
            {t("notAllowed.action", { screen: t(start.title) })}
          </Button>
        </div>
      </section>
    </div>
  );
}
