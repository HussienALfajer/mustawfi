import { Button } from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ACCESS_NAMESPACE } from "./messages.ts";
import { signOut } from "./session.ts";

export interface SignOutButtonProps {
  readonly onSignedOut: () => void;
}

/** Signs out, then drops every cached query: nothing of the tenant stays in memory. */
export function SignOutButton({ onSignedOut }: SignOutButtonProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.clear();
      onSignedOut();
    },
  });
  return (
    <div className="flex items-center gap-2">
      {mutation.isError ? (
        <span role="alert" className="text-sm text-text-negative">
          {t("signOut.failed")}
        </span>
      ) : null}
      <Button
        variant="quiet"
        isPending={mutation.isPending}
        onPress={() => {
          mutation.mutate();
        }}
      >
        {t("signOut.action")}
      </Button>
    </div>
  );
}
