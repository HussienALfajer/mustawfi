import { ApiUnreachable } from "@mustawfi/core-config/client";
import { Button, ConfirmDialog } from "@mustawfi/ui";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import { storeProfileQueryOptions } from "./queries.ts";
import { type StoreProfileDraft, StoreProfileForm } from "./store-profile-form.tsx";

/** A navigation held back because the form has unsaved changes (the app's router blocks it). */
export interface LeaveGuard {
  readonly proceed: () => void;
  readonly stay: () => void;
}

export interface StoreProfileScreenProps {
  readonly onDirtyChange?: (dirty: boolean) => void;
  /** Set while the app holds a navigation away from unsaved changes: the screen asks once. */
  readonly leave?: LeaveGuard | undefined;
  /** The live receipt preview, composed by the app (`StoreProfileFormProps.preview`). */
  readonly preview?: (draft: StoreProfileDraft) => ReactNode;
}

/** The store profile (settings form), online only: loads it, then edits it. */
export function StoreProfileScreen({ onDirtyChange, leave, preview }: StoreProfileScreenProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const profile = useQuery(storeProfileQueryOptions());
  return (
    <>
      {profile.data !== undefined ? (
        <StoreProfileForm
          profile={profile.data}
          {...(onDirtyChange === undefined ? {} : { onDirtyChange })}
          {...(preview === undefined ? {} : { preview })}
        />
      ) : profile.isError ? (
        <div role="alert" className="flex items-center gap-3 p-6 text-text-negative">
          <span>
            {t(profile.error instanceof ApiUnreachable ? "profile.offline" : "profile.loadFailed")}
          </span>
          <Button
            variant="secondary"
            onPress={() => {
              void profile.refetch();
            }}
          >
            {t("profile.retry")}
          </Button>
        </div>
      ) : (
        <p className="p-6 text-text-secondary">{t("profile.loading")}</p>
      )}
      <ConfirmDialog
        isOpen={leave !== undefined}
        onOpenChange={(open) => {
          if (!open) leave?.stay();
        }}
        title={t("profile.leave.title")}
        confirmLabel={t("profile.leave.confirm")}
        cancelLabel={t("profile.leave.cancel")}
        onConfirm={() => {
          leave?.proceed();
        }}
      >
        {t("profile.leave.body")}
      </ConfirmDialog>
    </>
  );
}
