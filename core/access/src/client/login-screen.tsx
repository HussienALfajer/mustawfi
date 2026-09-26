import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { Button, TextInput } from "@mustawfi/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { accessProblemCodes } from "../shared/index.ts";
import { ACCESS_NAMESPACE } from "./messages.ts";
import { type CurrentSession, sessionQueryKey, signIn } from "./session.ts";

/** Field problems are message keys under `login.`; the server checks everything else. */
const signInFormSchema = z.object({
  storeCode: z.string().trim().min(1, "required"),
  login: z.string().trim().min(1, "required"),
  password: z.string().min(1, "required"),
});

type SignInForm = z.infer<typeof signInFormSchema>;

const secondFactorFormSchema = z.object({
  code: z.string().trim().min(1, "required"),
});

/** The message key for a failed sign-in. */
function failureKey(error: unknown): string {
  if (error instanceof ApiUnreachable) return "login.unreachable";
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case accessProblemCodes.loginFailed:
        return "login.failed";
      case accessProblemCodes.secondFactorInvalid:
        return "login.secondFactor.invalid";
      case accessProblemCodes.loginThrottled:
        return "login.throttled";
      case accessProblemCodes.deviceRequired:
        return "login.deviceRequired";
      case accessProblemCodes.deviceRevoked:
        return "login.deviceRevoked";
    }
  }
  return "login.refused";
}

function needsSecondFactor(error: unknown): boolean {
  return error instanceof ApiProblem && error.code === accessProblemCodes.secondFactorRequired;
}

function Failure({ error }: { readonly error: unknown }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <p
      role="alert"
      className="rounded-sm bg-negative-tint px-pad-inline py-pad-block text-text-negative"
    >
      {t(failureKey(error))}
    </p>
  );
}

const FORM_CLASS =
  "flex w-full max-w-sm flex-col gap-density-gap rounded-md bg-surface p-6 shadow-floating";

export interface LoginScreenProps {
  readonly onSignedIn: (session: CurrentSession) => void;
  /**
   * The link to recovery with a support reset code (rule 27): the app routes, the screen gives
   * its text.
   */
  readonly recoveryLink?: (label: string) => ReactNode;
  /** Set after a support reset: the owner signs in with the password they just set. */
  readonly passwordWasReset?: boolean;
}

/**
 * Sign-in with store code, login, and password (ADR-0029), then — for a user with two-factor
 * authentication (`core-foundation` rule 26) — a second step for the authenticator app's code
 * or a recovery code. Keyboard first: the first field has focus on arrival and Enter submits.
 * A failure is shown as text in an alert, never a toast.
 */
export function LoginScreen({ onSignedIn, recoveryLink, passwordWasReset }: LoginScreenProps) {
  const [pending, setPending] = useState<SignInForm | undefined>();
  // Back from the second step: the store code and login stay, the password is typed again.
  const [typed, setTyped] = useState<SignInForm>({ storeCode: "", login: "", password: "" });
  if (pending !== undefined) {
    return (
      <SecondFactorStep
        credentials={pending}
        onSignedIn={onSignedIn}
        onBack={() => {
          setTyped({ storeCode: pending.storeCode, login: pending.login, password: "" });
          setPending(undefined);
        }}
      />
    );
  }
  return (
    <PasswordStep
      initial={typed}
      onSignedIn={onSignedIn}
      onSecondFactor={setPending}
      recoveryLink={recoveryLink}
      passwordWasReset={passwordWasReset === true}
    />
  );
}

function PasswordStep({
  initial,
  onSignedIn,
  onSecondFactor,
  recoveryLink,
  passwordWasReset,
}: {
  readonly initial: SignInForm;
  readonly onSignedIn: (session: CurrentSession) => void;
  readonly onSecondFactor: (credentials: SignInForm) => void;
  readonly recoveryLink: ((label: string) => ReactNode) | undefined;
  readonly passwordWasReset: boolean;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const form = useForm<SignInForm>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: initial,
  });
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
      onSignedIn(session);
    },
    onError: (error, credentials) => {
      if (needsSecondFactor(error)) onSecondFactor(credentials);
    },
  });
  const fieldError = (message: string | undefined) =>
    message === undefined ? undefined : t(`login.${message}`);

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <form
        noValidate
        aria-labelledby="login-title"
        className={FORM_CLASS}
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            mutation.mutate(values);
          })(event);
        }}
      >
        <h1 id="login-title" className="text-xl font-semibold text-text">
          {t("login.title")}
        </h1>
        {passwordWasReset ? (
          <p
            role="status"
            className="rounded-sm bg-positive-tint px-pad-inline py-pad-block text-text-positive"
          >
            {t("login.passwordWasReset")}
          </p>
        ) : null}
        <Controller
          control={form.control}
          name="storeCode"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("login.storeCode")}
              description={t("login.storeCodeHelp")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              dir="ltr"
              autoComplete="organization"
              spellCheck="false"
              autoFocus
            />
          )}
        />
        <Controller
          control={form.control}
          name="login"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("login.login")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              dir="ltr"
              autoComplete="username"
              spellCheck="false"
            />
          )}
        />
        <Controller
          control={form.control}
          name="password"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("login.password")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              type="password"
              dir="ltr"
              autoComplete="current-password"
            />
          )}
        />
        {mutation.isError && !needsSecondFactor(mutation.error) ? (
          <Failure error={mutation.error} />
        ) : null}
        <Button type="submit" isPending={mutation.isPending}>
          {mutation.isPending ? t("login.submitting") : t("login.submit")}
        </Button>
      </form>
      {recoveryLink?.(t("login.forgot"))}
    </div>
  );
}

/**
 * The second step (rule 26): the code the authenticator app shows now, or one recovery code.
 * The password typed in the first step is sent again with it and kept only in memory.
 */
function SecondFactorStep({
  credentials,
  onSignedIn,
  onBack,
}: {
  readonly credentials: SignInForm;
  readonly onSignedIn: (session: CurrentSession) => void;
  readonly onBack: () => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(secondFactorFormSchema),
    defaultValues: { code: "" },
  });
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
      onSignedIn(session);
    },
  });
  return (
    <form
      noValidate
      aria-labelledby="second-factor-title"
      className={FORM_CLASS}
      onSubmit={(event) => {
        void form.handleSubmit(({ code }) => {
          mutation.mutate({ ...credentials, secondFactor: code });
        })(event);
      }}
    >
      <h1 id="second-factor-title" className="text-xl font-semibold text-text">
        {t("login.secondFactor.title")}
      </h1>
      <p className="text-text-secondary">{t("login.secondFactor.help")}</p>
      <Controller
        control={form.control}
        name="code"
        render={({ field, fieldState }) => (
          <TextInput
            label={t("login.secondFactor.code")}
            description={t("login.secondFactor.codeHelp")}
            errorMessage={
              fieldState.error?.message === undefined
                ? undefined
                : t(`login.${fieldState.error.message}`)
            }
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            inputRef={field.ref}
            name={field.name}
            dir="ltr"
            autoComplete="one-time-code"
            spellCheck="false"
            autoFocus
          />
        )}
      />
      {mutation.isError ? <Failure error={mutation.error} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" isPending={mutation.isPending}>
          {mutation.isPending ? t("login.submitting") : t("login.secondFactor.submit")}
        </Button>
        <Button variant="quiet" onPress={onBack}>
          {t("login.secondFactor.back")}
        </Button>
      </div>
    </form>
  );
}
