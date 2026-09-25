import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { Button, TextInput } from "@mustawfi/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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

/** The message key for a failed sign-in. */
function failureKey(error: unknown): string {
  if (error instanceof ApiUnreachable) return "login.unreachable";
  if (error instanceof ApiProblem && error.code === accessProblemCodes.loginFailed) {
    return "login.failed";
  }
  return "login.refused";
}

export interface LoginScreenProps {
  readonly onSignedIn: (session: CurrentSession) => void;
}

/**
 * Sign-in with store code, login, and password (ADR-0029). Keyboard first: the store code has
 * focus on arrival and Enter submits. A failure is shown as text in an alert, never a toast.
 */
export function LoginScreen({ onSignedIn }: LoginScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const form = useForm<SignInForm>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: { storeCode: "", login: "", password: "" },
  });
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: (session) => {
      queryClient.setQueryData(sessionQueryKey, session);
      onSignedIn(session);
    },
  });
  const fieldError = (message: string | undefined) =>
    message === undefined ? undefined : t(`login.${message}`);

  return (
    <form
      noValidate
      aria-labelledby="login-title"
      className="flex w-full max-w-sm flex-col gap-density-gap rounded-md bg-surface p-6 shadow-floating"
      onSubmit={(event) => {
        void form.handleSubmit((values) => {
          mutation.mutate(values);
        })(event);
      }}
    >
      <h1 id="login-title" className="text-xl font-semibold text-text">
        {t("login.title")}
      </h1>
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
      {mutation.isError ? (
        <p
          role="alert"
          className="rounded-sm bg-negative-tint px-pad-inline py-pad-block text-text-negative"
        >
          {t(failureKey(mutation.error))}
        </p>
      ) : null}
      <Button type="submit" isPending={mutation.isPending}>
        {mutation.isPending ? t("login.submitting") : t("login.submit")}
      </Button>
    </form>
  );
}
