import { zodResolver } from "@hookform/resolvers/zod";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { hostProblemCodes } from "@mustawfi/core-config/shared";
import { isPhoneCountry, parsePhone, PHONE_COUNTRIES, type PhoneCountry } from "@mustawfi/kernel";
import {
  Button,
  EMPTY_PHONE,
  enterMovesToNextField,
  FormFooter,
  FormSection,
  Kbd,
  PhoneField,
  phoneValue,
  SegmentedControl,
  TextArea,
  TextInput,
  useShortcut,
  useToast,
} from "@mustawfi/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { FileTrigger } from "react-aria-components";
import { type Control, Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import {
  LOGO_PRINT_MODES,
  type LogoPrintMode,
  organizationProblemCodes,
  STORE_PHONES_MAX,
  storeProfileInputSchema,
  type StoreProfileView,
} from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import {
  canvasLogoCodec,
  type DecodedImage,
  LOGO_CHOSEN_TYPES,
  type LogoCodec,
  LogoReductionError,
  reduceLogo,
} from "./reduce-logo.ts";
import {
  removeStoreLogo,
  saveStoreProfile,
  storeLogoQueryOptions,
  storeProfileQueryKey,
  uploadStoreLogo,
} from "./queries.ts";

/**
 * One phone as the form holds it: the country it is read in and the number as typed. An empty
 * number is no phone; any other must be a real number there (`parsePhone`), saved in E.164.
 */
const phoneInputSchema = z
  .object({
    country: z.custom<PhoneCountry>(
      (value) => typeof value === "string" && PHONE_COUNTRIES.includes(value as PhoneCountry),
    ),
    number: z.string().trim(),
  })
  .transform((phone, context) => {
    if (phone.number === "") return null;
    const number = parsePhone(phone.number, phone.country);
    if (number === undefined) {
      context.addIssue({ code: "custom", message: "phoneInvalid", path: ["number"] });
      return z.NEVER;
    }
    return number;
  });

/**
 * The form's values: the server's own schema (`storeProfileInputSchema`), with each phone as a
 * country and a number that may stay empty.
 */
export const storeProfileFormSchema = storeProfileInputSchema.extend({
  phones: z
    .array(phoneInputSchema)
    .length(STORE_PHONES_MAX)
    .superRefine((phones, context) => {
      // The same number again, however written, is said on the field that repeats it.
      phones.forEach((phone, i) => {
        if (phone !== null && phones.indexOf(phone) < i) {
          context.addIssue({ code: "custom", message: "phoneRepeated", path: [i, "number"] });
        }
      });
    })
    .transform((phones) => phones.filter((phone) => phone !== null)),
});

type StoreProfileFormInput = z.input<typeof storeProfileFormSchema>;
type StoreProfileFormOutput = z.output<typeof storeProfileFormSchema>;

/** The stored phones then the unreadable ones, as the phone fields show them. */
function shownPhones(profile: StoreProfileView): string[] {
  return [...profile.phones, ...profile.unreadablePhones].slice(0, STORE_PHONES_MAX);
}

function formValues(profile: StoreProfileView) {
  return {
    name: profile.name,
    address: profile.address ?? "",
    phones: Array.from({ length: STORE_PHONES_MAX }, (_, i) => {
      const stored = shownPhones(profile)[i];
      return stored === undefined ? EMPTY_PHONE : phoneValue(stored);
    }),
    taxNumber: profile.taxNumber ?? "",
    commercialRegister: profile.commercialRegister ?? "",
    logoPrint: profile.logoPrint,
  } satisfies StoreProfileFormInput;
}

/**
 * What the receipt preview shows while the owner edits: the form's values as they stand (the
 * phones that are real numbers, in E.164), with the saved logo's image.
 */
export interface StoreProfileDraft {
  readonly name: string;
  readonly address: string | null;
  readonly phones: readonly string[];
  readonly taxNumber: string | null;
  readonly commercialRegister: string | null;
  readonly logoPrint: LogoPrintMode;
  /** The saved logo, or `null` for none or while it loads. */
  readonly logo: Blob | null;
}

function draftOf(values: StoreProfileFormInput, logo: Blob | null): StoreProfileDraft {
  const text = (value: string | null | undefined) => {
    const trimmed = value?.trim() ?? "";
    return trimmed === "" ? null : trimmed;
  };
  return {
    name: values.name.trim(),
    address: text(values.address),
    phones: values.phones.flatMap((phone) => {
      const number = isPhoneCountry(phone.country)
        ? parsePhone(phone.number, phone.country)
        : undefined;
      return number === undefined ? [] : [number];
    }),
    taxNumber: text(values.taxNumber),
    commercialRegister: text(values.commercialRegister),
    logoPrint: values.logoPrint ?? "threshold",
    logo,
  };
}

/** The message key of a field problem, under `profile.problem.`, from its issue code. */
function fieldProblem(type: string | undefined): string | undefined {
  if (type === undefined) return undefined;
  if (type === "too_big") return "tooLong";
  return "required";
}

/** The message key of a refusal, under `profile.problem.`. */
function refusalProblem(error: unknown): string {
  if (error instanceof LogoReductionError) return error.problem;
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case accessProblemCodes.permissionDenied:
      return "permissionDenied";
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

/** The saved logo's image and a URL to show it, while the profile has one. */
function useSavedLogo(profile: StoreProfileView): {
  readonly blob: Blob | null;
  readonly url: string | undefined;
  readonly failed: boolean;
} {
  const logo = useQuery({
    ...storeLogoQueryOptions(profile.logo?.sha256 ?? ""),
    enabled: profile.logo !== null,
  });
  const blob = profile.logo === null ? null : (logo.data ?? null);
  const [url, setUrl] = useState<string | undefined>();
  useEffect(() => {
    if (blob === null) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => {
      URL.revokeObjectURL(next);
    };
  }, [blob]);
  return { blob, url, failed: logo.isError };
}

function LogoSection({
  profile,
  url,
  failed,
  control,
  codec,
}: {
  readonly profile: StoreProfileView;
  readonly url: string | undefined;
  readonly failed: boolean;
  readonly control: Control<StoreProfileFormInput, unknown, StoreProfileFormOutput>;
  readonly codec: LogoCodec<DecodedImage>;
}) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const queryClient = useQueryClient();
  const [problem, setProblem] = useState<string | undefined>();
  const toast = useToast();
  const applied = async (saved: StoreProfileView, message: string) => {
    toast.show(t(message));
    queryClient.setQueryData(storeProfileQueryKey, saved);
    await queryClient.invalidateQueries({ queryKey: storeProfileQueryKey, exact: true });
  };
  const upload = useMutation({
    // Reduced here (at most 512 px, under 256 KB); the server checks the type and size again.
    mutationFn: async (file: Blob) => uploadStoreLogo(await reduceLogo(file, codec)),
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
  const printModes = LOGO_PRINT_MODES.map((mode) => ({
    id: mode,
    label: t(`profile.logo.print.${mode}`),
  }));

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
            acceptedFileTypes={[...LOGO_CHOSEN_TYPES]}
            onSelect={(files) => {
              setProblem(undefined);
              const file = files?.[0];
              if (file !== undefined) upload.mutate(file);
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
                remove.mutate();
              }}
            >
              {t("profile.logo.remove")}
            </Button>
          )}
        </div>
      </div>
      {failed ? <p className="text-text-negative">{t("profile.logo.loadFailed")}</p> : null}
      {problem === undefined ? null : (
        <p role="alert" className="text-text-negative">
          {t(`profile.problem.${problem}`)}
        </p>
      )}
      <Controller
        control={control}
        name="logoPrint"
        render={({ field }) => {
          const mode = field.value ?? "threshold";
          return (
            <div className="flex flex-col gap-2">
              <p className="font-medium">{t("profile.logo.print.label")}</p>
              <SegmentedControl
                label={t("profile.logo.print.label")}
                options={printModes}
                value={mode}
                onChange={field.onChange}
                className="self-start"
              />
              <p className="text-sm text-text-secondary">{t(`profile.logo.print.${mode}Help`)}</p>
            </div>
          );
        }}
      />
    </FormSection>
  );
}

/**
 * Renders the preview for the form's values as they stand. It watches them on its own, so a
 * keystroke re-renders the preview, not the whole form (three country pickers of 245 options).
 */
function LivePreview({
  control,
  defaults,
  logo,
  preview,
}: {
  readonly control: Control<StoreProfileFormInput, unknown, StoreProfileFormOutput>;
  readonly defaults: StoreProfileFormInput;
  readonly logo: Blob | null;
  readonly preview: (draft: StoreProfileDraft) => ReactNode;
}) {
  const values = useWatch({ control }) as StoreProfileFormInput;
  return preview(draftOf({ ...defaults, ...values }, logo));
}

export interface StoreProfileFormProps {
  readonly profile: StoreProfileView;
  /** Told whenever the form gains or loses unsaved changes, so the app can guard leaving. */
  readonly onDirtyChange?: (dirty: boolean) => void;
  /**
   * The receipt as the next sale would print it, for what the form holds now: the app composes
   * it from `sales`' template and its print pipeline. Beside the form on wide screens, below it
   * on narrow ones.
   */
  readonly preview?: (draft: StoreProfileDraft) => ReactNode;
  /** How a chosen logo is decoded and re-encoded; the browser's canvas by default. */
  readonly logoCodec?: LogoCodec<DecodedImage>;
}

/**
 * The store profile (settings form): sections on one page, a sticky footer with Save
 * (`Ctrl+S`) and Cancel, and the live receipt preview beside it. `Enter` moves to the next
 * field. A failed save keeps what was typed and says what to fix on the page. A phone stored
 * before slice 21 that is no real number is flagged at once, so the owner fixes it.
 */
export function StoreProfileForm({
  profile,
  onDirtyChange,
  preview,
  logoCodec = canvasLogoCodec,
}: StoreProfileFormProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const form = useForm<StoreProfileFormInput, unknown, StoreProfileFormOutput>({
    resolver: zodResolver(storeProfileFormSchema),
    defaultValues: formValues(profile),
  });
  const { isDirty } = form.formState;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  // A stored phone that is no real number (written before E.164) is said on its field at once.
  const flagged = useMemo(
    () =>
      shownPhones(profile).flatMap((stored, i) => {
        const value = phoneValue(stored);
        return isPhoneCountry(value.country) &&
          parsePhone(value.number, value.country) !== undefined
          ? []
          : [i];
      }),
    [profile],
  );
  useEffect(() => {
    if (flagged.length > 0) void form.trigger("phones");
  }, [flagged, form]);
  // Discard leaves with the changes it discarded; focus goes back to the form's first field
  // once the button is gone, so it is never lost.
  const discarded = useRef(false);
  useEffect(() => {
    if (isDirty || !discarded.current) return;
    discarded.current = false;
    form.setFocus("name");
  }, [isDirty, form]);
  const save = useMutation({
    mutationFn: saveStoreProfile,
    onSuccess: async (next) => {
      toast.show(t("profile.saved"));
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
  const logo = useSavedLogo(profile);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="grid w-full grid-cols-1 items-start gap-6 p-6 xl:grid-cols-[minmax(0,48rem)_auto]">
        <div className="flex min-w-0 flex-col gap-6">
          <form
            ref={formRef}
            noValidate
            onKeyDown={enterMovesToNextField}
            onSubmit={(event) => {
              void form.handleSubmit((submitted) => {
                save.mutate(submitted);
              })(event);
            }}
            className="flex flex-col gap-6"
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
            <FormSection
              title={t("profile.contact.title")}
              description={t("profile.contact.description")}
            >
              {flagged.length === 0 ? null : (
                <p className="text-text-warning">{t("profile.contact.flagged")}</p>
              )}
              {Array.from({ length: STORE_PHONES_MAX }, (_, i) => (
                <Controller
                  key={i}
                  control={form.control}
                  name={`phones.${i}`}
                  render={({ field }) => (
                    <PhoneField
                      label={t("profile.contact.phone", { number: i + 1 })}
                      countryLabel={t("profile.contact.countryCode", { number: i + 1 })}
                      description={i === 0 ? t("profile.contact.phoneHelp") : undefined}
                      errorMessage={
                        errors.phones?.[i] === undefined
                          ? undefined
                          : t(
                              errors.phones[i]?.number?.message === "phoneRepeated"
                                ? "profile.problem.phoneRepeated"
                                : "profile.problem.phoneInvalid",
                            )
                      }
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      inputRef={field.ref}
                      name={`${field.name}.number`}
                    />
                  )}
                />
              ))}
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
          <LogoSection
            profile={profile}
            url={logo.url}
            failed={logo.failed}
            control={form.control}
            codec={logoCodec}
          />
        </div>
        {preview === undefined ? null : (
          <aside
            aria-labelledby="receipt-preview-title"
            className="flex flex-col gap-2 xl:sticky xl:top-6"
          >
            <h2 id="receipt-preview-title" className="text-lg font-semibold">
              {t("profile.preview.title")}
            </h2>
            <p className="max-w-80 text-sm text-text-secondary">{t("profile.preview.help")}</p>
            <LivePreview
              control={form.control}
              defaults={formValues(profile)}
              logo={logo.blob}
              preview={preview}
            />
          </aside>
        )}
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
        {/* Discard exists only while there is something to discard, beside the reason. */}
        {isDirty ? (
          <Button
            variant="secondary"
            onPress={() => {
              save.reset();
              discarded.current = true;
              form.reset(formValues(profile));
            }}
          >
            {t("profile.cancel")}
          </Button>
        ) : null}
        <p role="status" className="min-h-5 text-sm">
          {isDirty ? <span className="text-text-warning">{t("profile.dirty")}</span> : null}
        </p>
        {save.error === null ? null : (
          <p role="alert" className="text-text-negative">
            {t(`profile.problem.${refusalProblem(save.error)}`)}
          </p>
        )}
      </FormFooter>
    </div>
  );
}
