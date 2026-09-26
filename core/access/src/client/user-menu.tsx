import { MenuButton } from "@mustawfi/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACCESS_NAMESPACE } from "./messages.ts";
import { sessionQueryOptions, signOut } from "./session.ts";

export interface UserMenuProps {
  /** Opens «My account» (`core-foundation` flow 11); the app routes. */
  readonly onAccount: () => void;
  /** After signing out; the app goes to sign-in. */
  readonly onSignedOut: () => void;
}

/**
 * The top bar's user menu (`screen-patterns.md`, the frame): the signed-in user's name and
 * role, opening «My account» and sign out (switching user joins in slice 15). Signing out drops
 * every cached query, so nothing of the tenant stays in memory; a failure stays on screen.
 */
export function UserMenu({ onAccount, onSignedOut }: UserMenuProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const session = useQuery(sessionQueryOptions()).data;
  const signingOut = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      onSignedOut();
    },
  });
  if (session === undefined || session === null) return null;
  return (
    <div className="flex items-center gap-2">
      {signingOut.isError ? (
        <span role="alert" className="text-sm text-text-negative">
          {t("signOut.failed")}
        </span>
      ) : null}
      <MenuButton
        actions={[
          {
            id: "account",
            label: t("userMenu.account"),
            icon: <UserRound size={16} strokeWidth={1.75} />,
          },
          {
            id: "signOut",
            label: t("signOut.action"),
            icon: <LogOut size={16} strokeWidth={1.75} />,
          },
        ]}
        onAction={(action) => {
          if (action === "account") onAccount();
          else signingOut.mutate();
        }}
      >
        <span className="flex flex-col text-sm leading-tight">
          <span>{session.user.name}</span>
          <span className="text-xs text-text-secondary">{session.user.role.name}</span>
        </span>
      </MenuButton>
    </div>
  );
}
