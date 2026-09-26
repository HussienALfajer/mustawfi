import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { Button, ConfirmDialog, SidePanel, TextArea } from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { accessProblemCodes, type DeviceView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { DeviceStatus, formatInstant } from "./devices-table.tsx";
import { issueRegistrationCode } from "../device.ts";
import { devicesQueryKey, revokeDevice } from "./queries.ts";

/** Why a devices request failed, as a `devices.problem.` key. */
function problemKey(error: unknown): string {
  if (error instanceof ApiUnreachable) return "offline";
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case accessProblemCodes.deviceAlreadyRevoked:
        return "alreadyRevoked";
      case accessProblemCodes.deviceNotFound:
        return "notFound";
      case accessProblemCodes.permissionDenied:
        return "denied";
    }
  }
  return "refused";
}

function Fact({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <>
      <dt className="text-text-secondary">{label}</dt>
      <dd className="text-text">{children}</dd>
    </>
  );
}

/** A new device: a registration code to type on it, with the store code, once issued. */
export function NewDevicePanel({ onClose }: { readonly onClose: () => void }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const issue = useMutation({ mutationFn: issueRegistrationCode });
  const issued = issue.data;
  return (
    <SidePanel
      title={t("devices.panel.newTitle")}
      closeLabel={t("devices.panel.close")}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <p className="text-text-secondary">{t("devices.issue.help")}</p>
        <div>
          <Button
            autoFocus
            isPending={issue.isPending}
            onPress={() => {
              issue.mutate();
            }}
          >
            {t("devices.issue.action")}
          </Button>
        </div>
        {issue.isError ? (
          <p role="alert" className="text-text-negative">
            {t(`devices.problem.${problemKey(issue.error)}`)}
          </p>
        ) : null}
        <div role="status">
          {issued === undefined ? null : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-md bg-sunken p-4">
              <Fact label={t("devices.issue.storeCode")}>
                <bdi dir="ltr" data-testid="store-code" className="font-mono text-lg font-semibold">
                  {issued.storeCode}
                </bdi>
              </Fact>
              <Fact label={t("devices.issue.code")}>
                <bdi
                  dir="ltr"
                  data-testid="registration-code"
                  className="font-mono text-lg font-semibold"
                >
                  {issued.code}
                </bdi>
              </Fact>
            </dl>
          )}
          {issued === undefined ? null : (
            <p className="mt-2 text-sm text-text-secondary">
              {t("devices.issue.expiresAt", { at: formatInstant(issued.expiresAt) })}
            </p>
          )}
        </div>
      </div>
    </SidePanel>
  );
}

export interface DevicePanelProps {
  readonly device: DeviceView;
  /** Whether it is the device this client is: revoking it signs this client out and wipes it. */
  readonly isCurrent: boolean;
  readonly onClose: () => void;
  /** Once the server has revoked it. */
  readonly onRevoked?: (device: DeviceView) => void;
}

/**
 * A device beside the list: its facts, its revoke (who, when, why) and whether it has wiped its
 * data yet; an active one can be revoked, with a reason (`screen-patterns.md`: a security action
 * confirms once and asks why).
 */
export function DevicePanel({ device, isCurrent, onClose, onRevoked }: DevicePanelProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const titleRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const [notice, setNotice] = useState<string | undefined>();
  const revoke = useMutation({
    mutationFn: (why: string) => revokeDevice(device.id, why),
    onSuccess: async (revoked) => {
      setConfirming(false);
      setReason("");
      setNotice(t("devices.panel.revoked", { name: revoked.name }));
      onRevoked?.(revoked);
      await queryClient.invalidateQueries({ queryKey: devicesQueryKey });
      // The button that opened the dialog is gone; focus stays in the panel.
      titleRef.current?.focus();
    },
    onError: () => {
      setConfirming(false);
    },
  });

  return (
    <SidePanel
      title={device.name}
      closeLabel={t("devices.panel.close")}
      onClose={onClose}
      footer={
        device.status === "active" ? (
          <Button
            variant="danger"
            className="ms-auto"
            onPress={() => {
              setNotice(undefined);
              revoke.reset();
              setReasonError(false);
              setConfirming(true);
            }}
          >
            {t("devices.panel.revoke")}
          </Button>
        ) : undefined
      }
    >
      <div ref={titleRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Fact label={t("devices.panel.status")}>
            <DeviceStatus device={device} />
          </Fact>
          <Fact label={t("devices.panel.type")}>{t(`device.types.${device.type}`)}</Fact>
          <Fact label={t("devices.panel.prefix")}>
            <bdi dir="ltr" className="font-mono">
              {device.prefix}
            </bdi>
          </Fact>
          <Fact label={t("devices.panel.registeredAt")}>{formatInstant(device.registeredAt)}</Fact>
          <Fact label={t("devices.panel.lastSync")}>
            {device.lastSyncAt === null
              ? t("devices.neverSynced")
              : formatInstant(device.lastSyncAt)}
          </Fact>
          {device.revokedAt === null ? null : (
            <>
              <Fact label={t("devices.panel.revokedAt")}>{formatInstant(device.revokedAt)}</Fact>
              <Fact label={t("devices.panel.revokedBy")}>{device.revokedBy?.name ?? ""}</Fact>
              <Fact label={t("devices.panel.reason")}>{device.revokeReason ?? ""}</Fact>
              <Fact label={t("devices.panel.wipe")}>
                {device.wipedAt === null
                  ? t("devices.panel.wipePending")
                  : t("devices.panel.wipedAt", { at: formatInstant(device.wipedAt) })}
              </Fact>
            </>
          )}
        </dl>
        {revoke.isError ? (
          <p role="alert" className="text-text-negative">
            {t(`devices.problem.${problemKey(revoke.error)}`)}
          </p>
        ) : null}
        <p role="status" className="min-h-5 text-text-positive">
          {notice}
        </p>
      </div>
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t("devices.revoke.title", { name: device.name })}
        confirmLabel={t("devices.revoke.confirm")}
        cancelLabel={t("devices.revoke.cancel")}
        isPending={revoke.isPending}
        onConfirm={() => {
          const why = reason.trim();
          if (why === "") {
            setReasonError(true);
            return;
          }
          revoke.mutate(why);
        }}
      >
        <div className="flex flex-col gap-3">
          <p>{t("devices.revoke.body")}</p>
          {isCurrent ? <p className="font-semibold">{t("devices.revoke.thisDevice")}</p> : null}
          <TextArea
            label={t("devices.revoke.reason")}
            description={t("devices.revoke.reasonHelp")}
            errorMessage={reasonError ? t("devices.problem.reasonRequired") : undefined}
            value={reason}
            onChange={(value) => {
              setReason(value);
              if (value.trim() !== "") setReasonError(false);
            }}
            maxLength={500}
            rows={2}
          />
        </div>
      </ConfirmDialog>
    </SidePanel>
  );
}
