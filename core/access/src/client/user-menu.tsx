import { MenuButton } from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, UserRound, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACCESS_NAMESPACE } from "./messages.ts";
import type { SignedIn } from "./pin/device-session.ts";
import { signOut } from "./session.ts";

export interface UserMenuProps {
  /** Who is signed in on this client. */
  readonly signedIn: SignedIn;
  /** Opens «My account» (`core-foundation` flow 11); the app routes. */
  readonly onAccount: () => void;
  /** After signing out of a client that is no device of the store; the app goes to sign-in. */
  readonly onSignedOut: () => void;
  /** On a device of the store: the next user signs in on the PIN screen (flow 12). */
  readonly onSwitchUser: () => void;
}

/**
 * The top bar's user menu (`screen-patterns.md`, the frame): the signed-in user's name and
 * role, opening «My account», and switching user on a device of the store — its users sign in by
 * PIN — or signing out elsewhere. Signing out drops every cached query, so nothing of the tenant
 * stays in memory; a failure stays on screen.
 */
export function UserMenu({ signedIn, onAccount, onSignedOut, onSwitchUser }: UserMenuProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const signingOut = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      onSignedOut();
    },
  });
  const onDevice = signedIn.device !== null;
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
          onDevice
            ? {
                id: "switchUser",
                label: t("userMenu.switchUser"),
                icon: <Users size={16} strokeWidth={1.75} />,
              }
            : {
                id: "signOut",
                label: t("signOut.action"),
                icon: <LogOut size={16} strokeWidth={1.75} />,
              },
        ]}
        onAction={(action) => {
          if (action === "account") onAccount();
          else if (action === "switchUser") onSwitchUser();
          else signingOut.mutate();
        }}
      >
        <span className="flex flex-col text-sm leading-tight">
          <span>{signedIn.user.name}</span>
          <span className="text-xs text-text-secondary">{signedIn.user.role.name}</span>
        </span>
      </MenuButton>
    </div>
  );
}
