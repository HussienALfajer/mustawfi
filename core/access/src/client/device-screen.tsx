import { ApiProblem, ApiUnreachable, useClientRuntime } from "@mustawfi/core-config/client";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { useLocalDb } from "@mustawfi/local-db";
import { Button, TextInput } from "@mustawfi/ui";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { accessProblemCodes, deviceNameSchema, type DeviceType } from "../shared/index.ts";
import {
  DeviceAlreadyRegistered,
  issueRegistrationCode,
  localDeviceQueryKey,
  localDeviceQueryOptions,
  registerThisDevice,
} from "./device.ts";
import { ACCESS_NAMESPACE } from "./messages.ts";

const registerFormSchema = z.object({
  storeCode: z.string().trim().min(1, "required"),
  registrationCode: z.string().trim().min(1, "required"),
  name: z
    .string()
    .trim()
    .min(1, "required")
    .refine((name) => deviceNameSchema.safeParse(name).success, "tooLong"),
});

type RegisterForm = z.infer<typeof registerFormSchema>;

function registerFailureKey(error: unknown): string {
  if (error instanceof ApiUnreachable) return "device.unreachable";
  if (error instanceof DeviceAlreadyRegistered) return "device.alreadyRegistered";
  if (error instanceof ApiProblem) {
    switch (error.code) {
      case accessProblemCodes.registrationFailed:
        return "device.registrationFailed";
      case tenancyProblemCodes.mainPosDeviceLimit:
        return "device.mainPosLimit";
      case tenancyProblemCodes.companionDeviceLimit:
        return "device.companionLimit";
    }
  }
  return "device.refused";
}

function IssueCodeSection(props: { readonly onIssued: (storeCode: string) => void }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const mutation = useMutation({
    mutationFn: issueRegistrationCode,
    onSuccess: (issued) => {
      props.onIssued(issued.storeCode);
    },
  });
  const issued = mutation.data;
  return (
    <section aria-labelledby="issue-code-title" className="flex flex-col gap-density-gap">
      <h2 id="issue-code-title" className="text-lg font-semibold text-text">
        {t("device.issue.title")}
      </h2>
      <p className="text-text-secondary">{t("device.issue.help")}</p>
      <div>
        <Button
          variant="secondary"
          isPending={mutation.isPending}
          onPress={() => {
            mutation.mutate();
          }}
        >
          {t("device.issue.action")}
        </Button>
      </div>
      {mutation.isError ? (
        <p role="alert" className="text-text-negative">
          {t(mutation.error instanceof ApiUnreachable ? "device.unreachable" : "device.refused")}
        </p>
      ) : null}
      {issued === undefined ? null : (
        <p role="status" className="text-text">
          {t("device.issue.issued")}{" "}
          <bdi
            dir="ltr"
            data-testid="registration-code"
            className="font-mono text-lg font-semibold"
          >
            {issued.code}
          </bdi>
        </p>
      )}
    </section>
  );
}

function RegisterSection(props: { readonly deviceType: DeviceType }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const db = useLocalDb();
  const { clock } = useClientRuntime();
  const queryClient = useQueryClient();
  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: { storeCode: "", registrationCode: "", name: "" },
  });
  const mutation = useMutation({
    mutationFn: (values: RegisterForm) =>
      registerThisDevice(
        db,
        {
          type: props.deviceType,
          storeCode: values.storeCode.trim(),
          registrationCode: values.registrationCode.trim(),
          name: values.name.trim(),
        },
        clock,
      ),
    networkMode: "always",
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: localDeviceQueryKey });
    },
  });
  const fieldError = (message: string | undefined) =>
    message === undefined ? undefined : t(`device.${message}`);

  return (
    <section aria-labelledby="register-title" className="flex flex-col gap-density-gap">
      <h2 id="register-title" className="text-lg font-semibold text-text">
        {t("device.register.title")}
      </h2>
      <p className="text-text-secondary">{t("device.register.help")}</p>
      <IssueCodeSection
        onIssued={(storeCode) => {
          form.setValue("storeCode", storeCode);
        }}
      />
      <form
        noValidate
        aria-labelledby="register-title"
        className="grid grid-cols-1 items-start gap-density-gap rounded-md bg-surface p-4 md:grid-cols-3"
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            mutation.mutate(values);
          })(event);
        }}
      >
        <Controller
          control={form.control}
          name="storeCode"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("device.register.storeCode")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              dir="ltr"
              autoComplete="off"
              spellCheck="false"
            />
          )}
        />
        <Controller
          control={form.control}
          name="registrationCode"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("device.register.registrationCode")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              dir="ltr"
              autoComplete="off"
              spellCheck="false"
            />
          )}
        />
        <Controller
          control={form.control}
          name="name"
          render={({ field, fieldState }) => (
            <TextInput
              label={t("device.register.name")}
              description={t("device.register.nameHelp")}
              errorMessage={fieldError(fieldState.error?.message)}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              autoComplete="off"
            />
          )}
        />
        <div className="flex flex-col gap-2 md:col-span-3">
          {mutation.isError ? (
            <p role="alert" className="text-text-negative">
              {t(registerFailureKey(mutation.error))}
            </p>
          ) : null}
          <div>
            <Button type="submit" isPending={mutation.isPending}>
              {t("device.register.submit")}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

export interface DeviceScreenProps {
  /** What this client registers as: the app shell decides (ADR-0022). */
  readonly deviceType: DeviceType;
}

/**
 * This client as a device (flow 4): its registration, or the form that registers it with a
 * registration code the owner issues.
 */
export function DeviceScreen(props: DeviceScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const db = useLocalDb();
  const device = useQuery(localDeviceQueryOptions(db));

  return (
    <div className="flex flex-col gap-8">
      <h1 className="text-xl font-semibold text-text">{t("device.title")}</h1>
      {device.isError ? (
        <p role="alert" className="text-text-negative">
          {t("device.localFailed")}
        </p>
      ) : device.data === undefined ? (
        <p className="text-text-secondary">{t("device.loading")}</p>
      ) : device.data === null ? (
        <RegisterSection deviceType={props.deviceType} />
      ) : (
        <dl className="grid max-w-md grid-cols-2 gap-2 rounded-md bg-surface p-4">
          <dt className="text-text-secondary">{t("device.registered.name")}</dt>
          <dd className="text-text">{device.data.name}</dd>
          <dt className="text-text-secondary">{t("device.registered.prefix")}</dt>
          <dd>
            <bdi
              dir="ltr"
              data-testid="device-prefix"
              className="font-mono font-semibold text-text"
            >
              {device.data.prefix}
            </bdi>
          </dd>
          <dt className="text-text-secondary">{t("device.registered.type")}</dt>
          <dd className="text-text" data-testid="device-type">
            {t(`device.types.${device.data.type}`)}
          </dd>
          <dt className="text-text-secondary">{t("device.registered.state")}</dt>
          <dd className="text-text-positive">{t("device.registered.ready")}</dd>
        </dl>
      )}
    </div>
  );
}
