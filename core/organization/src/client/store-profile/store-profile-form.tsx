import { zodResolver } from "@hookform/resolvers/zod";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { hostProblemCodes } from "@mustawfi/core-config/shared";
import {
  Button,
  enterMovesToNextField,
  FormFooter,
  FormSection,
  Kbd,
  TextArea,
  TextInput,
  useShortcut,
} from "@mustawfi/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  logoTypeOf,
  organizationProblemCodes,
  phoneSchema,
  storeProfileInputSchema,
  type StoreProfileView,
} from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import {
  removeStoreLogo,
  saveStoreProfile,
  storeLogoQueryOptions,
  storeProfileQueryKey,
  uploadStoreLogo,
} from "./queries.ts";

/** Up to three phone fields; an empty one is simply not sent. */
const PHONE_FIELDS = 3;

/**
 * The form's values: the server's own schema (`storeProfileInputSchema`), with the phones as
 * three fields that may stay empty.
 */
export const storeProfileFormSchema = storeProfileInputSchema.extend({
  phones: z
    .array(z.union([z.string().trim().length(0), phoneSchema]))
    .length(PHONE_FIELDS)
    .transform((phones) => phones.filter((phone) => phone !== "")),
});

type StoreProfileFormInput = z.input<typeof storeProfileFormSchema>;

function formValues(profile: StoreProfileView) {
  return {
    name: profile.name,
    address: profile.address ?? "",
    phones: Array.from({ length: PHONE_FIELDS }, (_, i) => profile.phones[i] ?? ""),
    taxNumber: profile.taxNumber ?? "",
    commercialRegister: profile.commercialRegister ?? "",
  } satisfies StoreProfileFormInput;
}

/** The message key of a field problem, under `profile.problem.`, from its issue code. */
function fieldProblem(type: string | undefined): string | undefined {
  if (type === undefined) return undefined;
  if (type === "too_big") return "tooLong";
  return "required";
}

/** The message key of a refusal, under `profile.problem.`. */
function refusalProblem(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case accessProblemCodes.ownerRequired:
      return "ownerRequired";
    case organizationProblemCodes.logoTooLarge:
      return "logoTooLarge";
    case organizationProblemCodes.logoUnsupportedType:
      return "logoType";
    case hostProblemCodes.invalidRequest:
      return "invalid";
    default:
      return "refused";
  }
}

function LogoSection({ profile }: { readonly profile: StoreProfileView }) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | undefined>();
  const [done, setDone] = useState<string | undefined>();
  const logo = useQuery({
    ...storeLogoQueryOptions(profile.logo?.sha256 ?? ""),
    enabled: profile.logo !== null,
  });
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (logo.data === undefined || profile.logo === null) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(logo.data);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [logo.data, profile.logo]);
  const applied = async (saved: StoreProfileView, message: string) => {
    setDone(t(message));
    queryClient.setQueryData(storeProfileQueryKey, saved);
    await queryClient.invalidateQueries({ queryKey: storeProfileQueryKey, exact: true });
  };
  const upload = useMutation({
    mutationFn: uploadStoreLogo,
    onSuccess: (saved) => applied(saved, "profile.logo.uploaded"),
    onError: (error) => {
      setProblem(refusalProblem(error));
    },
  });
  const remove = useMutation({
    mutationFn: removeStoreLogo,
    onSuccess: (saved) => applied(saved, "profile.logo.removed"),
    onError: (error) => {
      setProblem(refusalProblem(error));
    },
  });
  const choose = async (files: FileList | null) => {
    setProblem(undefined);
    setDone(undefined);
    const file = files?.[0];
    if (file === undefined) return;
    // Checked here for a quick answer; the server checks the same rules again.
    if (file.size > LOGO_MAX_BYTES) {
      setProblem("logoTooLarge");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (logoTypeOf(bytes) === undefined) {
      setProblem("logoType");
      return;
    }
    upload.mutate(bytes);
  };

  return (
    <FormSection title={t("profile.logo.title")} description={t("profile.logo.description")}>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex size-24 items-center justify-center border border-dashed border-field-border bg-sunken text-center text-xs text-text-muted">
          {url === undefined ? (
            profile.logo === null ? (
              t("profile.logo.none")
            ) : null
          ) : (
            <img src={url} alt={t("profile.logo.current")} className="max-h-full max-w-full" />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <FileTrigger
            acceptedFileTypes={[...LOGO_TYPES]}
            onSelect={(files) => {
              void choose(files);
            }}
          >
            <Button variant="secondary" isPending={upload.isPending}>
              {t(profile.logo === null ? "profile.logo.choose" : "profile.logo.replace")}
            </Button>
          </FileTrigger>
          {profile.logo === null ? null : (
            <Button
              variant="quiet"
              isPending={remove.isPending}
              onPress={() => {
                setProblem(undefined);
                setDone(undefined);
                remove.mutate();
              }}
            >
              {t("profile.logo.remove")}
            </Button>
          )}
        </div>
      </div>
      {logo.isError ? <p className="text-text-negative">{t("profile.logo.loadFailed")}</p> : null}
      {problem === undefined ? null : (
        <p role="alert" className="text-text-negative">
          {t(`profile.problem.${problem}`)}
        </p>
      )}
      <p role="status" className="text-text-positive min-h-5">
        {done}
      </p>
    </FormSection>
  );
}

export interface StoreProfileFormProps {
  readonly profile: StoreProfileView;
  /** Told whenever the form gains or loses unsaved changes, so the app can guard leaving. */
  readonly onDirtyChange?: (dirty: boolean) => void;
}

/**
 * The store profile (settings form): sections on one page, a sticky footer with Save
 * (`Ctrl+S`) and Cancel. `Enter` moves to the next field. A failed save keeps what was typed
 * and says what to fix on the page.
 */
export function StoreProfileForm({ profile, onDirtyChange }: StoreProfileFormProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [saved, setSaved] = useState(false);
  const form = useForm({
    resolver: zodResolver(storeProfileFormSchema),
    defaultValues: formValues(profile),
  });
  const { isDirty } = form.formState;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  const save = useMutation({
    mutationFn: saveStoreProfile,
    onSuccess: async (next) => {
      setSaved(true);
      form.reset(formValues(next));
      queryClient.setQueryData(storeProfileQueryKey, next);
      await queryClient.invalidateQueries({ queryKey: storeProfileQueryKey, exact: true });
    },
  });
  useShortcut({ key: "s", ctrl: true }, () => {
    formRef.current?.requestSubmit();
  });
  const error = (type: string | undefined) => {
    const key = fieldProblem(type);
    return key === undefined ? undefined : t(`profile.problem.${key}`);
  };
  const { errors } = form.formState;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <form
        ref={formRef}
        noValidate
        onKeyDown={enterMovesToNextField}
        onSubmit={(event) => {
          setSaved(false);
          void form.handleSubmit((values) => {
            save.mutate(values);
          })(event);
        }}
        className="flex w-full max-w-3xl flex-col gap-6 p-6"
      >
        <FormSection
          title={t("profile.identity.title")}
          description={t("profile.identity.description")}
        >
          <Controller
            control={form.control}
            name="name"
            render={({ field }) => (
              <TextInput
                label={t("profile.identity.name")}
                errorMessage={error(errors.name?.type)}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                name={field.name}
                autoComplete="organization"
              />
            )}
          />
        </FormSection>
        <FormSection title={t("profile.contact.title")}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Array.from({ length: PHONE_FIELDS }, (_, i) => (
              <Controller
                key={i}
                control={form.control}
                name={`phones.${i}`}
                render={({ field }) => (
                  <TextInput
                    label={t("profile.contact.phone", { number: i + 1 })}
                    description={i === 0 ? t("profile.contact.phoneHelp") : undefined}
                    errorMessage={
                      errors.phones?.[i] === undefined
                        ? undefined
                        : t("profile.problem.phoneInvalid")
                    }
                    value={field.value}
                    onChange={field.onChange}
                    onBlur={field.onBlur}
                    inputRef={field.ref}
                    name={field.name}
                    dir="ltr"
                    type="tel"
                    autoComplete="off"
                  />
                )}
              />
            ))}
          </div>
          <Controller
            control={form.control}
            name="address"
            render={({ field }) => (
              <TextArea
                label={t("profile.contact.address")}
                errorMessage={error(errors.address?.type)}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                name={field.name}
                rows={2}
              />
            )}
          />
        </FormSection>
        <FormSection title={t("profile.legal.title")}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Controller
              control={form.control}
              name="taxNumber"
              render={({ field }) => (
                <TextInput
                  label={t("profile.legal.taxNumber")}
                  errorMessage={error(errors.taxNumber?.type)}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  name={field.name}
                  dir="ltr"
                  autoComplete="off"
                />
              )}
            />
            <Controller
              control={form.control}
              name="commercialRegister"
              render={({ field }) => (
                <TextInput
                  label={t("profile.legal.commercialRegister")}
                  errorMessage={error(errors.commercialRegister?.type)}
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  name={field.name}
                  dir="ltr"
                  autoComplete="off"
                />
              )}
            />
          </div>
        </FormSection>
      </form>
      <div className="flex w-full max-w-3xl flex-col gap-6 px-6 pb-6">
        <LogoSection profile={profile} />
      </div>
      <FormFooter className="mt-auto">
        <Button
          aria-keyshortcuts="Control+S"
          isPending={save.isPending}
          onPress={() => formRef.current?.requestSubmit()}
        >
          {t("profile.save")}
          <Kbd shortcut="Control+S" />
        </Button>
        <Button
          variant="secondary"
          onPress={() => {
            setSaved(false);
            save.reset();
            form.reset(formValues(profile));
          }}
        >
          {t("profile.cancel")}
        </Button>
        {save.error === null ? null : (
          <p role="alert" className="text-text-negative">
            {t(`profile.problem.${refusalProblem(save.error)}`)}
          </p>
        )}
        <p role="status" className="text-sm min-h-5">
          {isDirty ? (
            <span className="text-text-warning">{t("profile.dirty")}</span>
          ) : saved ? (
            <span className="text-text-positive">{t("profile.saved")}</span>
          ) : null}
        </p>
      </FormFooter>
    </div>
  );
}
