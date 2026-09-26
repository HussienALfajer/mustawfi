import { zodResolver } from "@hookform/resolvers/zod";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { hostProblemCodes } from "@mustawfi/core-config/shared";
import { Button, enterMovesToNextField, FormSection, TextInput } from "@mustawfi/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { type Control, Controller, type FieldValues, type Path, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  type AccountView,
  accessProblemCodes,
  passwordSchema,
  pinSchema,
  type TwoFactorEnrolment,
} from "../../shared/index.ts";
import { formatInstant } from "../devices/devices-table.tsx";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { QrCode } from "./qr-code.tsx";
import {
  accountQueryKey,
  accountQueryOptions,
  changeOwnPassword,
  changeOwnPin,
  confirmTwoFactor,
  disableTwoFactor,
  startTwoFactor,
} from "./queries.ts";

/** The message key of a refusal, under `account.problem.`. */
function refusalKey(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case accessProblemCodes.currentSecretWrong:
      return "currentWrong";
    case accessProblemCodes.loginRequired:
      return "loginRequired";
    case accessProblemCodes.twoFactorCodeInvalid:
      return "codeInvalid";
    case accessProblemCodes.twoFactorPasswordRequired:
      return "passwordRequired";
    case accessProblemCodes.twoFactorAlreadyEnabled:
      return "alreadyEnabled";
    case accessProblemCodes.twoFactorNotEnabled:
      return "notEnabled";
    case accessProblemCodes.twoFactorNotStarted:
      return "notStarted";
    case hostProblemCodes.invalidRequest:
      return "invalid";
    default:
      return "refused";
  }
}

/** A new secret typed twice, checked with the server's own schema; problems are message keys. */
function newSecretSchema(schema: z.ZodType, problem: "pinInvalid" | "passwordShort") {
  return z
    .object({
      current: z.string().min(1, "required"),
      next: z.string().superRefine((value, context) => {
        if (!schema.safeParse(value).success)
          context.addIssue({ code: "custom", message: problem });
      }),
      confirm: z.string(),
    })
    .superRefine((value, context) => {
      if (value.confirm !== value.next) {
        context.addIssue({ code: "custom", message: "mismatch", path: ["confirm"] });
      }
    });
}

const pinFormSchema = newSecretSchema(pinSchema, "pinInvalid");
const passwordFormSchema = newSecretSchema(passwordSchema, "passwordShort");
type NewSecretForm = z.infer<typeof pinFormSchema>;

const EMPTY_SECRET: NewSecretForm = { current: "", next: "", confirm: "" };

/** A text field bound to a form field, with its problem (a message key under `account.problem.`). */
function Field<T extends FieldValues>({
  control,
  name,
  label,
  description,
  secret = true,
  autoComplete,
  autoFocus,
}: {
  readonly control: Control<T>;
  readonly name: Path<T>;
  readonly label: string;
  readonly description?: string;
  readonly secret?: boolean;
  readonly autoComplete: string;
  readonly autoFocus?: boolean;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInput
          label={label}
          {...(description === undefined ? {} : { description })}
          errorMessage={
            fieldState.error?.message === undefined
              ? undefined
              : t(`account.problem.${fieldState.error.message}`)
          }
          value={field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          inputRef={field.ref}
          name={field.name}
          {...(secret ? { type: "password" } : {})}
          dir="ltr"
          spellCheck="false"
          autoComplete={autoComplete}
          {...(autoFocus === true ? { autoFocus } : {})}
        />
      )}
    />
  );
}

/** What a section reports after its action: success as status, failure as an alert. */
function Outcome({ done, error }: { readonly done: string | undefined; readonly error: unknown }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <>
      {error === null || error === undefined ? null : (
        <p role="alert" className="text-text-negative">
          {t(`account.problem.${refusalKey(error)}`)}
        </p>
      )}
      <p role="status" className="min-h-5 text-text-positive">
        {done}
      </p>
    </>
  );
}

/**
 * Changes the user's PIN (rule 19), proved with the current PIN — or with the password while
 * they have no PIN yet (a store's first owner).
 */
function PinSection({ account }: { readonly account: AccountView }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | undefined>();
  const form = useForm<NewSecretForm>({
    resolver: zodResolver(pinFormSchema),
    defaultValues: EMPTY_SECRET,
  });
  const byPin = account.hasPin;
  const change = useMutation({
    mutationFn: ({ current, next }: NewSecretForm) =>
      changeOwnPin(byPin ? { currentPin: current } : { currentPassword: current }, next),
    onSuccess: async () => {
      form.reset(EMPTY_SECRET);
      setDone(t("account.pin.changed"));
      await queryClient.invalidateQueries({ queryKey: accountQueryKey });
    },
  });
  return (
    <FormSection title={t("account.pin.title")} description={t("account.pin.description")}>
      <form
        noValidate
        aria-label={t("account.pin.title")}
        onKeyDown={enterMovesToNextField}
        onSubmit={(event) => {
          setDone(undefined);
          void form.handleSubmit((values) => {
            change.mutate(values);
          })(event);
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field
            control={form.control}
            name="current"
            label={t(byPin ? "account.pin.current" : "account.pin.currentPassword")}
            autoComplete={byPin ? "off" : "current-password"}
          />
          <Field
            control={form.control}
            name="next"
            label={t("account.pin.next")}
            description={t("account.pin.nextHelp")}
            autoComplete="off"
          />
          <Field
            control={form.control}
            name="confirm"
            label={t("account.pin.confirm")}
            autoComplete="off"
          />
        </div>
        <div>
          <Button type="submit" variant="secondary" isPending={change.isPending}>
            {t("account.pin.submit")}
          </Button>
        </div>
        <Outcome done={done} error={change.error} />
      </form>
    </FormSection>
  );
}

/**
 * Changes the user's password, proved with the current one — or with the PIN while they have
 * none. A user without a login cannot have a password (rule 19), so the section is not shown.
 */
function PasswordSection({ account }: { readonly account: AccountView }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const [done, setDone] = useState<string | undefined>();
  const form = useForm<NewSecretForm>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: EMPTY_SECRET,
  });
  const byPassword = account.hasPassword;
  const change = useMutation({
    mutationFn: ({ current, next }: NewSecretForm) =>
      changeOwnPassword(byPassword ? { currentPassword: current } : { currentPin: current }, next),
    onSuccess: async () => {
      form.reset(EMPTY_SECRET);
      setDone(t(byPassword ? "account.password.changed" : "account.password.set"));
      await queryClient.invalidateQueries({ queryKey: accountQueryKey });
    },
  });
  return (
    <FormSection
      title={t("account.password.title")}
      description={t("account.password.description")}
    >
      <form
        noValidate
        aria-label={t("account.password.title")}
        onKeyDown={enterMovesToNextField}
        onSubmit={(event) => {
          setDone(undefined);
          void form.handleSubmit((values) => {
            change.mutate(values);
          })(event);
        }}
        className="flex flex-col gap-4"
      >
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field
            control={form.control}
            name="current"
            label={t(byPassword ? "account.password.current" : "account.password.currentPin")}
            autoComplete={byPassword ? "current-password" : "off"}
          />
          <Field
            control={form.control}
            name="next"
            label={t("account.password.next")}
            description={t("account.password.nextHelp")}
            autoComplete="new-password"
          />
          <Field
            control={form.control}
            name="confirm"
            label={t("account.password.confirm")}
            autoComplete="new-password"
          />
        </div>
        <div>
          <Button type="submit" variant="secondary" isPending={change.isPending}>
            {t("account.password.submit")}
          </Button>
        </div>
        <Outcome done={done} error={change.error} />
      </form>
    </FormSection>
  );
}

const passwordOnlySchema = z.object({ currentPassword: z.string().min(1, "required") });
const codeSchema = z.object({ code: z.string().trim().min(1, "required") });
const disableSchema = passwordOnlySchema.extend(codeSchema.shape);

/** Base32 in groups of four, as people copy it into an app by hand. */
function groupSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/** Step one: the password starts the setup. */
function StartTwoFactor({ onStarted }: { readonly onStarted: (e: TwoFactorEnrolment) => void }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const form = useForm({
    resolver: zodResolver(passwordOnlySchema),
    defaultValues: { currentPassword: "" },
  });
  const start = useMutation({ mutationFn: startTwoFactor, onSuccess: onStarted });
  return (
    <form
      noValidate
      aria-label={t("account.twoFactor.start")}
      onSubmit={(event) => {
        void form.handleSubmit(({ currentPassword }) => {
          start.mutate(currentPassword);
        })(event);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-text-secondary">{t("account.twoFactor.offHelp")}</p>
      <div className="max-w-sm">
        <Field
          control={form.control}
          name="currentPassword"
          label={t("account.twoFactor.currentPassword")}
          autoComplete="current-password"
        />
      </div>
      <div>
        <Button type="submit" variant="secondary" isPending={start.isPending}>
          {t("account.twoFactor.start")}
        </Button>
      </div>
      <Outcome done={undefined} error={start.error} />
    </form>
  );
}

/** Step two: the app reads the QR code (or the secret typed by hand), and its code turns it on. */
function ConfirmTwoFactor({
  enrolment,
  onConfirmed,
  onCancel,
}: {
  readonly enrolment: TwoFactorEnrolment;
  readonly onConfirmed: (codes: readonly string[]) => void;
  readonly onCancel: () => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const form = useForm({ resolver: zodResolver(codeSchema), defaultValues: { code: "" } });
  const confirm = useMutation({ mutationFn: confirmTwoFactor, onSuccess: onConfirmed });
  return (
    <form
      noValidate
      aria-label={t("account.twoFactor.confirmTitle")}
      onSubmit={(event) => {
        void form.handleSubmit(({ code }) => {
          confirm.mutate(code);
        })(event);
      }}
      className="flex flex-col gap-4"
    >
      <ol className="flex list-decimal flex-col gap-1 ps-5 text-text">
        <li>{t("account.twoFactor.stepApp")}</li>
        <li>{t("account.twoFactor.stepScan")}</li>
        <li>{t("account.twoFactor.stepCode")}</li>
      </ol>
      <div className="flex flex-wrap items-start gap-6">
        <QrCode value={enrolment.uri} label={t("account.twoFactor.qrLabel")} />
        <div className="flex flex-col gap-1">
          <span className="text-sm text-text-secondary">{t("account.twoFactor.secret")}</span>
          <code
            dir="ltr"
            aria-label={t("account.twoFactor.secret")}
            className="font-mono text-lg tracking-wide text-text [unicode-bidi:isolate]"
          >
            {groupSecret(enrolment.secret)}
          </code>
        </div>
      </div>
      <div className="max-w-sm">
        <Field
          control={form.control}
          name="code"
          label={t("account.twoFactor.code")}
          description={t("account.twoFactor.codeHelp")}
          secret={false}
          autoComplete="one-time-code"
          autoFocus
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" isPending={confirm.isPending}>
          {t("account.twoFactor.confirm")}
        </Button>
        <Button variant="quiet" onPress={onCancel}>
          {t("account.twoFactor.cancel")}
        </Button>
      </div>
      <Outcome done={undefined} error={confirm.error} />
    </form>
  );
}

/** Step three: the recovery codes, shown this once. */
function RecoveryCodes({
  codes,
  onSaved,
}: {
  readonly codes: readonly string[];
  readonly onSaved: () => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <div className="flex flex-col gap-4">
      <h3 ref={heading} tabIndex={-1} className="font-semibold text-text-positive">
        {t("account.twoFactor.enabledNow")}
      </h3>
      <p className="rounded-sm bg-warning-tint px-pad-inline py-pad-block text-text-warning">
        {t("account.twoFactor.codesOnce")}
      </p>
      <ul
        aria-label={t("account.twoFactor.codesLabel")}
        dir="ltr"
        className="grid w-fit grid-cols-2 gap-x-8 gap-y-1 font-mono text-lg text-text"
      >
        {codes.map((code) => (
          <li key={code} className="[unicode-bidi:isolate]">
            {code}
          </li>
        ))}
      </ul>
      <div>
        <Button onPress={onSaved}>{t("account.twoFactor.saved")}</Button>
      </div>
    </div>
  );
}

/** Two-factor authentication is on: its state, and turning it off with the password and a code. */
function DisableTwoFactor({ account }: { readonly account: AccountView }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(disableSchema),
    defaultValues: { currentPassword: "", code: "" },
  });
  const disable = useMutation({
    mutationFn: ({ currentPassword, code }: z.infer<typeof disableSchema>) =>
      disableTwoFactor(currentPassword, code),
    onSuccess: async () => {
      form.reset();
      await queryClient.invalidateQueries({ queryKey: accountQueryKey });
    },
  });
  const { enabledAt, recoveryCodesLeft } = account.twoFactor;
  return (
    <form
      noValidate
      aria-label={t("account.twoFactor.disable")}
      onKeyDown={enterMovesToNextField}
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          disable.mutate(values);
        })(event);
      }}
      className="flex flex-col gap-4"
    >
      <p className="text-text">
        <span className="font-semibold text-text-positive">{t("account.twoFactor.on")}</span>{" "}
        {enabledAt === null ? null : t("account.twoFactor.since", { at: formatInstant(enabledAt) })}
      </p>
      <p className={recoveryCodesLeft <= 2 ? "text-text-warning" : "text-text-secondary"}>
        {t("account.twoFactor.codesLeft", { count: recoveryCodesLeft })}
      </p>
      <p className="text-text-secondary">{t("account.twoFactor.disableHelp")}</p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field
          control={form.control}
          name="currentPassword"
          label={t("account.twoFactor.currentPassword")}
          autoComplete="current-password"
        />
        <Field
          control={form.control}
          name="code"
          label={t("account.twoFactor.codeOrRecovery")}
          secret={false}
          autoComplete="one-time-code"
        />
      </div>
      <div>
        <Button type="submit" variant="danger" isPending={disable.isPending}>
          {t("account.twoFactor.disable")}
        </Button>
      </div>
      <Outcome done={undefined} error={disable.error} />
    </form>
  );
}

type TwoFactorStage =
  | { readonly kind: "idle" }
  | { readonly kind: "enrolling"; readonly enrolment: TwoFactorEnrolment }
  | { readonly kind: "codes"; readonly codes: readonly string[] };

/**
 * Two-factor authentication (rule 26, flow 11): for users with a password; set up with the
 * password, a QR code, and the app's first code; then ten recovery codes shown once.
 */
function TwoFactorSection({ account }: { readonly account: AccountView }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<TwoFactorStage>({ kind: "idle" });
  const refresh = () => queryClient.invalidateQueries({ queryKey: accountQueryKey });
  let body;
  if (stage.kind === "codes") {
    body = (
      <RecoveryCodes
        codes={stage.codes}
        onSaved={() => {
          setStage({ kind: "idle" });
          void refresh();
        }}
      />
    );
  } else if (account.twoFactor.enabled) {
    body = <DisableTwoFactor account={account} />;
  } else if (!account.hasPassword) {
    body = <p className="text-text-secondary">{t("account.twoFactor.needsPassword")}</p>;
  } else if (stage.kind === "enrolling") {
    body = (
      <ConfirmTwoFactor
        enrolment={stage.enrolment}
        onConfirmed={(codes) => {
          setStage({ kind: "codes", codes });
        }}
        onCancel={() => {
          setStage({ kind: "idle" });
        }}
      />
    );
  } else {
    body = (
      <StartTwoFactor
        onStarted={(enrolment) => {
          setStage({ kind: "enrolling", enrolment });
        }}
      />
    );
  }
  return (
    <FormSection
      title={t("account.twoFactor.title")}
      description={t("account.twoFactor.description")}
    >
      {body}
    </FormSection>
  );
}

/**
 * «My account» (settings form, flow 11): the signed-in user's PIN, password, and two-factor
 * authentication. Each section proves and saves on its own, since each needs its own current
 * secret; nothing typed is kept after a change. Online only.
 */
export function AccountScreen() {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const account = useQuery(accountQueryOptions());
  if (account.data === undefined) {
    return account.isError ? (
      <div role="alert" className="flex items-center gap-3 p-6 text-text-negative">
        <span>
          {t(account.error instanceof ApiUnreachable ? "account.offline" : "account.loadFailed")}
        </span>
        <Button
          variant="secondary"
          onPress={() => {
            void account.refetch();
          }}
        >
          {t("account.retry")}
        </Button>
      </div>
    ) : (
      <p className="p-6 text-text-secondary">{t("account.loading")}</p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex w-full max-w-3xl flex-col gap-6 p-6">
        <p className="text-text-secondary">
          {t("account.signedInAs", {
            name: account.data.name,
            login: account.data.login ?? t("account.noLogin"),
          })}
        </p>
        <PinSection account={account.data} />
        {account.data.login === null ? null : <PasswordSection account={account.data} />}
        <TwoFactorSection account={account.data} />
      </div>
    </div>
  );
}
