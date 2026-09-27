import { zodResolver } from "@hookform/resolvers/zod";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { hostProblemCodes } from "@mustawfi/core-config/shared";
import { Button, enterMovesThenSubmits, PasswordField, TextInput } from "@mustawfi/ui";
import { useMutation } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { accessProblemCodes, passwordSchema, pinSchema } from "../shared/index.ts";
import { ACCESS_NAMESPACE } from "./messages.ts";
import { resetPasswordWithCode } from "./session.ts";
import { storeCodeFieldSchema } from "./store-code-field.ts";
import { throttleWaitMinutes } from "./throttle.ts";

/**
 * The form's values, on the server's own rules: the password as `passwordSchema`, the PIN, when
 * support asked for one, as `pinSchema`. Problems are message keys under `recovery.problem.`.
 */
const recoveryFormSchema = z
  .object({
    storeCode: storeCodeFieldSchema,
    login: z.string().trim().min(1, "required"),
    code: z.string().trim().min(1, "required"),
    password: z.string().superRefine((value, context) => {
      if (!passwordSchema.safeParse(value).success) {
        context.addIssue({ code: "custom", message: "passwordShort" });
      }
    }),
    confirmPassword: z.string(),
    pin: z.string().superRefine((value, context) => {
      if (value !== "" && !pinSchema.safeParse(value).success) {
        context.addIssue({ code: "custom", message: "pinInvalid" });
      }
    }),
  })
  .superRefine((value, context) => {
    if (value.confirmPassword !== value.password) {
      context.addIssue({ code: "custom", message: "mismatch", path: ["confirmPassword"] });
    }
  });

type RecoveryForm = z.infer<typeof recoveryFormSchema>;

function refusalKey(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case accessProblemCodes.resetCodeInvalid:
        return "codeInvalid";
      case accessProblemCodes.loginThrottled:
        return "throttled";
      case hostProblemCodes.invalidRequest:
        return "invalid";
    }
  }
  return "refused";
}

export interface PasswordResetScreenProps {
  /** The new password is set: back to sign-in with it. */
  readonly onReset: () => void;
  /** The link back to sign-in: the app routes, the screen gives its text. */
  readonly backLink: (label: string) => ReactNode;
}

/**
 * Recovery with a support reset code (`core-foundation` rule 27, *Screens*: «Recovery with a
 * support reset code»): an owner who lost their password types the code Vertex support gave
 * them and sets a new password — and a new PIN when support asked. Their two-factor
 * authentication is cleared with it (rule 26). The code works once, for thirty minutes.
 */
export function PasswordResetScreen({ onReset, backLink }: PasswordResetScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const form = useForm<RecoveryForm>({
    resolver: zodResolver(recoveryFormSchema),
    defaultValues: {
      storeCode: "",
      login: "",
      code: "",
      password: "",
      confirmPassword: "",
      pin: "",
    },
  });
  const mutation = useMutation({ mutationFn: resetPasswordWithCode, onSuccess: onReset });
  const problem = (message: string | undefined) =>
    message === undefined ? undefined : t(`recovery.problem.${message}`);

  const field = (
    name: keyof RecoveryForm,
    props: {
      readonly label: string;
      readonly description?: string;
      /** A secret is hidden, with a toggle to show it; a PIN brings the digit keyboard. */
      readonly secret?: "text" | "pin";
      readonly autoComplete: string;
      readonly autoFocus?: boolean;
    },
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field: control, fieldState }) => {
        const { secret, ...shown } = props;
        const common = {
          ...shown,
          errorMessage: problem(fieldState.error?.message),
          value: control.value,
          onChange: control.onChange,
          onBlur: control.onBlur,
          inputRef: control.ref,
          name: control.name,
        };
        return secret === undefined ? (
          <TextInput {...common} dir="ltr" spellCheck="false" />
        ) : (
          <PasswordField
            {...common}
            {...(secret === "pin" ? { inputMode: "numeric" as const, maxLength: 6 } : {})}
          />
        );
      }}
    />
  );

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-4">
      <form
        noValidate
        aria-labelledby="recovery-title"
        onKeyDown={enterMovesThenSubmits}
        className="flex w-full flex-col gap-density-gap rounded-md bg-surface p-6 shadow-floating"
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            mutation.mutate({
              storeCode: values.storeCode,
              login: values.login,
              code: values.code,
              password: values.password,
              ...(values.pin === "" ? {} : { pin: values.pin }),
            });
          })(event);
        }}
      >
        <h1 id="recovery-title" className="text-xl font-semibold text-text">
          {t("recovery.title")}
        </h1>
        <p className="text-text-secondary">{t("recovery.help")}</p>
        {field("storeCode", {
          label: t("login.storeCode"),
          autoComplete: "organization",
          autoFocus: true,
        })}
        {field("login", { label: t("login.login"), autoComplete: "username" })}
        {field("code", {
          label: t("recovery.code"),
          description: t("recovery.codeHelp"),
          secret: "text",
          autoComplete: "one-time-code",
        })}
        {field("password", {
          label: t("recovery.password"),
          description: t("recovery.passwordHelp"),
          secret: "text",
          autoComplete: "new-password",
        })}
        {field("confirmPassword", {
          label: t("recovery.confirmPassword"),
          secret: "text",
          autoComplete: "new-password",
        })}
        {field("pin", {
          label: t("recovery.pin"),
          description: t("recovery.pinHelp"),
          secret: "pin",
          autoComplete: "off",
        })}
        {mutation.isError ? (
          <p
            role="alert"
            className="rounded-sm bg-negative-tint px-pad-inline py-pad-block text-text-negative"
          >
            {t(`recovery.problem.${refusalKey(mutation.error)}`, {
              minutes: throttleWaitMinutes(
                mutation.error instanceof ApiProblem ? mutation.error.retryAfterSeconds : undefined,
              ),
            })}
          </p>
        ) : null}
        <Button type="submit" isPending={mutation.isPending}>
          {t("recovery.submit")}
        </Button>
      </form>
      {backLink(t("recovery.back"))}
    </div>
  );
}
