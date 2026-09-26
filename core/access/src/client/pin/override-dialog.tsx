import { type BundleVerifier, useClientRuntime } from "@mustawfi/core-config/client";
import { useLocalDb } from "@mustawfi/local-db";
import { Button, ModalDialog } from "@mustawfi/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { OverrideRequest, SupervisorOverride } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { checkPinWithArgon2 } from "./check-pin.ts";
import { overrideOnDevice } from "./override.ts";
import { PinPad, PinTiles, type Problem } from "./pin-screen.tsx";
import { type PinTile, overrideSupervisorsQueryOptions } from "./queries.ts";

export interface SupervisorOverrideDialogProps {
  /** The action that needs approval; the dialog is open while it is set. */
  readonly request: OverrideRequest | undefined;
  /** The signed-in user whose action it is: never their own supervisor. */
  readonly requestedBy: string;
  /** Why the action needs a supervisor, in a sentence the calling module writes. */
  readonly reason: string;
  /** How this app checks the bundle the supervisors and their verifiers come from. */
  readonly bundleVerifier: BundleVerifier;
  /** Approved: the override to attach to the document. */
  readonly onGranted: (override: SupervisorOverride) => void;
  /** Closed without an approval. */
  readonly onCancel: () => void;
}

/**
 * The supervisor override (flow 15, rule 18, touch panel in a dialog): a supervisor whose role
 * covers the action picks their name and enters their PIN, checked on this device against the
 * verified bundle, online or not. Granted or refused, the device audits it; the document then
 * carries the override, and the server checks the supervisor's role again when it arrives.
 */
export function SupervisorOverrideDialog(props: SupervisorOverrideDialogProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <ModalDialog
      isOpen={props.request !== undefined}
      onOpenChange={(open) => {
        if (!open) props.onCancel();
      }}
      title={t("override.title")}
      density="touch"
    >
      {props.request === undefined ? null : <OverrideSteps {...props} request={props.request} />}
    </ModalDialog>
  );
}

function OverrideSteps(
  props: SupervisorOverrideDialogProps & { readonly request: OverrideRequest },
) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const db = useLocalDb();
  const { clock, audit, newId } = useClientRuntime();
  const supervisors = useQuery(
    overrideSupervisorsQueryOptions(db, props.bundleVerifier, props.request, props.requestedBy),
  ).data;
  // Kept as picked: a supervisor locked out by their fifth wrong PIN leaves the list, and the pad
  // stays to say so.
  const [chosen, setChosen] = useState<PinTile | undefined>();
  const [problem, setProblem] = useState<Problem | undefined>();
  // Closed (Esc, a press outside, cancel) while a PIN is checked: its answer approves nothing.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);
  const approve = useMutation({
    mutationFn: (input: { readonly supervisorId: string; readonly pin: string }) =>
      overrideOnDevice(
        db,
        { request: props.request, requestedBy: props.requestedBy, ...input },
        { clock, audit, newId, checkPin: checkPinWithArgon2, verifier: props.bundleVerifier },
      ),
    networkMode: "always",
  });

  const submit = async (id: string, name: string, pin: string): Promise<boolean> => {
    setProblem(undefined);
    try {
      const outcome = await approve.mutateAsync({ supervisorId: id, pin });
      if (!open.current) return true;
      switch (outcome.outcome) {
        case "granted":
          props.onGranted(outcome.override);
          return true;
        case "notCovered":
          setProblem({ message: t("override.notCovered", { name }) });
          return false;
        case "notAllowed":
          setProblem({ message: t("override.notAllowed") });
          return false;
        case "wrongPin":
          setProblem({ message: t("pin.wrongPin", { attemptsLeft: outcome.attemptsLeft }) });
          return false;
        case "lockedOut":
          setProblem({ message: t("pin.lockedOut", { name }) });
          return false;
        case "locked":
          setProblem({ message: t("pin.locked", { name }) });
          return false;
        case "unavailable":
          setProblem({ message: t("pin.unavailable") });
          return false;
        case "noBundle":
          setProblem({ message: t("pin.noBundleOffline") });
          return false;
      }
    } catch (error) {
      console.error("the override could not be checked", error);
      setProblem({ message: t("override.failed") });
      return false;
    }
  };

  let body: ReactNode;
  if (supervisors === undefined) {
    body = null;
  } else if (chosen === undefined) {
    body =
      supervisors.length === 0 ? (
        <p className="text-text">{t("override.noSupervisors")}</p>
      ) : (
        <>
          <p className="text-text-secondary">{t("override.chooseSupervisor")}</p>
          <PinTiles
            label={t("override.supervisors")}
            tiles={supervisors}
            onPick={(tile) => {
              setProblem(undefined);
              setChosen(tile);
            }}
          />
        </>
      );
  } else {
    body = (
      <PinPad
        key={`override-${chosen.id}`}
        label={t("override.supervisorPin", { name: chosen.name })}
        pending={approve.isPending}
        problem={problem}
        notice={undefined}
        onSubmit={(pin) => submit(chosen.id, chosen.name, pin)}
        backLabel={t("override.back")}
        onBack={() => {
          setProblem(undefined);
          setChosen(undefined);
        }}
        onUnlock={undefined}
      />
    );
  }
  return (
    <>
      <p className="text-text">{props.reason}</p>
      {body}
      <div>
        <Button variant="quiet" onPress={props.onCancel}>
          {t("override.cancel")}
        </Button>
      </div>
    </>
  );
}
