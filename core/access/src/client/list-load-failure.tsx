import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { Button } from "@mustawfi/ui";
import { useTranslation } from "react-i18next";
import { accessProblemCodes } from "../shared/index.ts";
import { ACCESS_NAMESPACE } from "./messages.ts";

/**
 * Why a list did not load, under `<screen>.`: offline, not allowed, or refused, with a retry.
 * Stays on screen until the list loads.
 */
export function ListLoadFailure({
  screen,
  error,
  onRetry,
}: {
  readonly screen: "users" | "roles" | "devices";
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const key =
    error instanceof ApiUnreachable
      ? "offline"
      : error instanceof ApiProblem && error.code === accessProblemCodes.permissionDenied
        ? "denied"
        : "loadFailed";
  return (
    <div role="alert" className="flex items-center gap-3 text-text-negative">
      <span>{t(`${screen}.${key}`)}</span>
      {key === "denied" ? null : (
        <Button variant="secondary" onPress={onRetry}>
          {t(`${screen}.retry`)}
        </Button>
      )}
    </div>
  );
}
