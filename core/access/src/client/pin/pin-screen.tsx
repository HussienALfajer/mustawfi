import { type BundleVerifier, useClientRuntime } from "@mustawfi/core-config/client";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { useLocalDb } from "@mustawfi/local-db";
import { Badge, Button, TextInput } from "@mustawfi/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { accessProblemCodes } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { type CurrentSession, sessionQueryKey } from "../session.ts";
import { checkPinWithArgon2 } from "./check-pin.ts";
import {
  type PinSignInDependencies,
  type PinSignInOutcome,
  signInWithPin,
  unlockOnDevice,
} from "./device-session.ts";
import { type PinTile, pinScreenQueryOptions } from "./queries.ts";

/** At most six digits (rule 19); anything else typed is dropped. */
function digitsOf(typed: string): string {
  return typed.replace(/\D/g, "").slice(0, 6);
}

type Step =
  | { readonly kind: "tiles" }
  | { readonly kind: "pin"; readonly userId: string; readonly notice?: string }
  | { readonly kind: "supervisors"; readonly lockedUserId: string }
  | {
      readonly kind: "supervisorPin";
      readonly lockedUserId: string;
      readonly supervisorId: string;
    };

/** A refusal or a failure to show under the pad, and whether it offers a supervisor's unlock. */
export interface Problem {
  readonly message: string;
  readonly unlock?: boolean;
}

function refusalKey(code: string): string {
  switch (code) {
    case accessProblemCodes.loginFailed:
      return "pin.wrongPinOnline";
    case accessProblemCodes.loginThrottled:
      return "pin.throttled";
    case accessProblemCodes.deviceRevoked:
      return "pin.deviceRevoked";
    case accessProblemCodes.deviceRequired:
      return "pin.deviceRequired";
    case tenancyProblemCodes.licenseSuspended:
      return "pin.suspended";
  }
  return "pin.refused";
}

export function PinTiles(props: {
  readonly label: string;
  readonly tiles: readonly PinTile[];
  readonly onPick: (tile: PinTile) => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <ul
      aria-label={props.label}
      className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3"
    >
      {props.tiles.map((tile, index) => (
        <li key={tile.id}>
          <Button
            variant="secondary"
            autoFocus={index === 0}
            className="h-full w-full flex-col items-start gap-1 py-3 text-start whitespace-normal"
            onPress={() => {
              props.onPick(tile);
            }}
          >
            <span className="font-semibold">{tile.name}</span>
            <span className="text-sm font-normal text-text-secondary">{tile.roleName}</span>
            {tile.locked ? <Badge tone="negative">{t("pin.tileLocked")}</Badge> : null}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The PIN pad (touch panel): a field the keyboard types into — digits, Enter to submit, Esc to go
 * back — and the same digits as 48 px buttons for a touch screen, which leave the focus in the
 * field.
 */
export function PinPad(props: {
  readonly label: string;
  readonly pending: boolean;
  readonly problem: Problem | undefined;
  readonly notice: string | undefined;
  readonly onSubmit: (pin: string) => Promise<boolean>;
  readonly onBack: (() => void) | undefined;
  readonly backLabel: string;
  readonly onUnlock: (() => void) | undefined;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const [pin, setPin] = useState("");
  const [missing, setMissing] = useState(false);
  const submit = () => {
    if (props.pending) return;
    if (pin === "") {
      setMissing(true);
      return;
    }
    void props.onSubmit(pin).then((done) => {
      // A PIN is never kept once checked.
      if (!done) setPin("");
    });
  };
  const press = (digit: string) => {
    setMissing(false);
    setPin((current) => digitsOf(current + digit));
  };
  return (
    <form
      noValidate
      className="flex w-full max-w-xs flex-col gap-4 self-center"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <TextInput
        label={props.label}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        autoFocus
        dir="ltr"
        value={pin}
        // Read-only, not disabled, while the PIN is checked: the focus stays for the next try.
        isReadOnly={props.pending}
        errorMessage={missing ? t("pin.pinRequired") : undefined}
        onChange={(value) => {
          setMissing(false);
          setPin(digitsOf(value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && props.onBack !== undefined) props.onBack();
          else event.continuePropagation();
        }}
      />
      <div role="group" aria-label={t("pin.pad")} className="grid grid-cols-3 gap-2" dir="ltr">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <Button
            key={digit}
            variant="secondary"
            excludeFromTabOrder
            preventFocusOnPress
            isDisabled={props.pending}
            className="text-xl"
            onPress={() => {
              press(digit);
            }}
          >
            {digit}
          </Button>
        ))}
        <Button
          variant="quiet"
          excludeFromTabOrder
          preventFocusOnPress
          isDisabled={props.pending}
          onPress={() => {
            setPin((current) => current.slice(0, -1));
          }}
        >
          {t("pin.erase")}
        </Button>
        <Button
          variant="secondary"
          excludeFromTabOrder
          preventFocusOnPress
          isDisabled={props.pending}
          className="text-xl"
          onPress={() => {
            press("0");
          }}
        >
          0
        </Button>
        <Button type="submit" isPending={props.pending}>
          {props.pending ? t("pin.checking") : t("pin.submit")}
        </Button>
      </div>
      {props.notice === undefined ? null : (
        <p
          role="status"
          className="rounded-sm bg-positive-tint px-pad-inline py-pad-block text-text"
        >
          {props.notice}
        </p>
      )}
      {props.problem === undefined ? null : (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-sm bg-negative-tint px-pad-inline py-pad-block text-text-negative"
        >
          <p>{props.problem.message}</p>
          {props.problem.unlock === true ? <p>{t("pin.lockedHelp")}</p> : null}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {props.onUnlock === undefined ? null : (
          <Button variant="secondary" onPress={props.onUnlock}>
            {t("pin.unlockAction")}
          </Button>
        )}
        {props.onBack === undefined ? null : (
          <Button variant="quiet" aria-keyshortcuts="Escape" onPress={props.onBack}>
            {props.backLabel}
          </Button>
        )}
      </div>
    </form>
  );
}

export interface PinScreenProps {
  /** How this app checks the bundle the users and their verifiers come from. */
  readonly bundleVerifier: BundleVerifier;
  /**
   * Rule 25: the user signed in on this device without the server asks for a server session —
   * straight to their pad, checked by the server only.
   */
  readonly reconnect?: boolean;
  /** The link to password sign-in (owners without a PIN, flow 4): the app routes. */
  readonly passwordLink: (label: string) => ReactNode;
  /** Signed in: with the server's session when it answered, else checked on the device. */
  readonly onSignedIn: (server: CurrentSession | null) => void;
  /** Leaves a reconnect without signing in again. */
  readonly onCancel?: () => void;
  /**
   * A reconnect of a user with no PIN on this device (signed in by password): their session here
   * ends, and they sign in by password again.
   */
  readonly onPasswordInstead?: () => void;
}

/**
 * The PIN screen (flows 12–13, touch panel): the name tiles of the users allowed on this device,
 * then the pad. It is also where the device returns after auto-lock and a user switch. The PIN
 * is checked by the server when it answers and against the verified bundle when it does not;
 * five wrong PINs lock the name on this device until a supervisor unlocks it (rule 20).
 */
export function PinScreen({
  bundleVerifier,
  reconnect = false,
  passwordLink,
  onSignedIn,
  onCancel,
  onPasswordInstead,
}: PinScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const db = useLocalDb();
  const { clock, audit } = useClientRuntime();
  const queryClient = useQueryClient();
  const data = useQuery(pinScreenQueryOptions(db, bundleVerifier)).data;
  const [chosen, setChosen] = useState<Step>({ kind: "tiles" });
  const [problem, setProblem] = useState<Problem | undefined>();
  const dependencies: PinSignInDependencies = {
    clock,
    audit,
    checkPin: checkPinWithArgon2,
    verifier: bundleVerifier,
  };
  const reconnectUser = reconnect ? data?.session?.userId : undefined;
  const step: Step = reconnectUser === undefined ? chosen : { kind: "pin", userId: reconnectUser };
  const tileOf = (userId: string) => data?.tiles.find((tile) => tile.id === userId);
  const go = (next: Step) => {
    setProblem(undefined);
    setChosen(next);
  };

  const signIn = useMutation({
    mutationFn: (input: { readonly userId: string; readonly pin: string }) =>
      signInWithPin(db, { ...input, serverOnly: reconnect }, dependencies),
    networkMode: "always",
  });
  const unlock = useMutation({
    mutationFn: (input: {
      readonly lockedUserId: string;
      readonly supervisorId: string;
      readonly pin: string;
    }) => unlockOnDevice(db, input, dependencies),
    networkMode: "always",
  });

  const signInProblem = (outcome: PinSignInOutcome, name: string): Problem => {
    switch (outcome.outcome) {
      case "wrongPin":
        return { message: t("pin.wrongPin", { attemptsLeft: outcome.attemptsLeft }) };
      case "lockedOut":
        return { message: t("pin.lockedOut", { name }), unlock: true };
      case "locked":
        return { message: t("pin.locked", { name }), unlock: true };
      case "refused":
        return { message: t(refusalKey(outcome.code)) };
      case "noBundle":
        return { message: t("pin.noBundleOffline") };
      case "unreachable":
        return { message: t("pin.unreachable") };
      case "unavailable":
        return { message: t("pin.unavailable") };
      case "signedIn":
        return { message: "" };
    }
  };

  const submitPin = async (userId: string, pin: string): Promise<boolean> => {
    setProblem(undefined);
    try {
      const outcome = await signIn.mutateAsync({ userId, pin });
      if (outcome.outcome === "signedIn") {
        // Nothing of the previous user's server session may speak for this one.
        queryClient.removeQueries({ queryKey: sessionQueryKey });
        if (outcome.server !== null) queryClient.setQueryData(sessionQueryKey, outcome.server);
        onSignedIn(outcome.server);
        return true;
      }
      setProblem(signInProblem(outcome, tileOf(userId)?.name ?? ""));
    } catch (error) {
      console.error("the PIN could not be checked", error);
      setProblem({ message: t("pin.failed") });
    }
    return false;
  };

  const submitUnlock = async (
    lockedUserId: string,
    supervisorId: string,
    pin: string,
  ): Promise<boolean> => {
    setProblem(undefined);
    const lockedName = tileOf(lockedUserId)?.name ?? "";
    const supervisorName = tileOf(supervisorId)?.name ?? "";
    try {
      const outcome = await unlock.mutateAsync({ lockedUserId, supervisorId, pin });
      switch (outcome.outcome) {
        case "unlocked":
          go({
            kind: "pin",
            userId: lockedUserId,
            notice: t("pin.unlocked", { name: lockedName }),
          });
          return true;
        case "notLocked":
          go({
            kind: "pin",
            userId: lockedUserId,
            notice: t("pin.notLocked", { name: lockedName }),
          });
          return true;
        case "notAllowed":
          setProblem({ message: t("pin.notAllowed", { name: supervisorName }) });
          return false;
        case "noBundle":
          setProblem({ message: t("pin.noBundleOffline") });
          return false;
        case "wrongPin":
        case "lockedOut":
        case "locked":
        case "unavailable":
          setProblem(signInProblem(outcome, supervisorName));
          return false;
      }
    } catch (error) {
      console.error("the unlock could not be checked", error);
      setProblem({ message: t("pin.failed") });
      return false;
    }
  };

  const title = reconnect ? t("pin.titleReconnect") : t("pin.title");
  let body: ReactNode;
  if (data === undefined) {
    body = null;
  } else if (!data.registered) {
    body = <p className="text-text">{t("pin.notRegistered")}</p>;
  } else if (!data.hasBundle || data.tiles.length === 0) {
    body = (
      <div className="flex flex-col gap-4">
        <p className="text-text">{t(data.hasBundle ? "pin.noUsers" : "pin.noBundle")}</p>
        {reconnect && onPasswordInstead !== undefined ? (
          <div>
            <Button autoFocus onPress={onPasswordInstead}>
              {t("pin.passwordLink")}
            </Button>
          </div>
        ) : null}
      </div>
    );
  } else if (step.kind === "tiles") {
    body = (
      <PinTiles
        label={t("pin.users")}
        tiles={data.tiles}
        onPick={(tile) => {
          go({ kind: "pin", userId: tile.id });
        }}
      />
    );
  } else if (step.kind === "pin") {
    const tile = tileOf(step.userId);
    body =
      tile === undefined ? (
        <div className="flex flex-col gap-4">
          <p className="text-text">{t("pin.unavailable")}</p>
          {reconnect && onPasswordInstead !== undefined ? (
            <div>
              <Button autoFocus onPress={onPasswordInstead}>
                {t("pin.passwordLink")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <PinPad
          key={`pin-${tile.id}`}
          label={t("pin.pinFor", { name: tile.name })}
          pending={signIn.isPending}
          problem={problem}
          notice={step.notice}
          onSubmit={(pin) => submitPin(tile.id, pin)}
          backLabel={reconnect ? t("pin.cancel") : t("pin.back")}
          onBack={
            reconnect
              ? onCancel
              : () => {
                  go({ kind: "tiles" });
                }
          }
          onUnlock={
            !reconnect && (tile.locked || problem?.unlock === true)
              ? () => {
                  go({ kind: "supervisors", lockedUserId: tile.id });
                }
              : undefined
          }
        />
      );
  } else if (step.kind === "supervisors") {
    const supervisors = data.tiles.filter(
      (tile) => tile.mayUnlock && !tile.locked && tile.id !== step.lockedUserId,
    );
    body = (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-text">
          {t("pin.unlockTitle", { name: tileOf(step.lockedUserId)?.name ?? "" })}
        </h2>
        {supervisors.length === 0 ? (
          <p className="text-text">{t("pin.noSupervisors")}</p>
        ) : (
          <>
            <p className="text-text-secondary">{t("pin.chooseSupervisor")}</p>
            <PinTiles
              label={t("pin.supervisors")}
              tiles={supervisors}
              onPick={(tile) => {
                go({
                  kind: "supervisorPin",
                  lockedUserId: step.lockedUserId,
                  supervisorId: tile.id,
                });
              }}
            />
          </>
        )}
        <div>
          <Button
            variant="quiet"
            onPress={() => {
              go({ kind: "pin", userId: step.lockedUserId });
            }}
          >
            {t("pin.back")}
          </Button>
        </div>
      </div>
    );
  } else {
    const supervisor = tileOf(step.supervisorId);
    body = (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-text">
          {t("pin.unlockTitle", { name: tileOf(step.lockedUserId)?.name ?? "" })}
        </h2>
        <PinPad
          key={`unlock-${step.supervisorId}`}
          label={t("pin.supervisorPin", { name: supervisor?.name ?? "" })}
          pending={unlock.isPending}
          problem={problem}
          notice={undefined}
          onSubmit={(pin) => submitUnlock(step.lockedUserId, step.supervisorId, pin)}
          backLabel={t("pin.back")}
          onBack={() => {
            go({ kind: "supervisors", lockedUserId: step.lockedUserId });
          }}
          onUnlock={undefined}
        />
      </div>
    );
  }

  return (
    <section
      aria-labelledby="pin-title"
      data-density="touch"
      className="flex w-full max-w-3xl flex-col gap-6 rounded-md bg-surface p-6 shadow-floating"
    >
      <h1 id="pin-title" className="text-xl font-bold text-text">
        {title}
      </h1>
      {reconnect ? <p className="text-text-secondary">{t("pin.reconnectHelp")}</p> : null}
      {body}
      {reconnect ? null : <div>{passwordLink(t("pin.passwordLink"))}</div>}
    </section>
  );
}
