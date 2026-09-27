import { LOCALE } from "@mustawfi/i18n";
import {
  DEFAULT_PHONE_COUNTRY,
  PHONE_COUNTRIES,
  PHONE_TEXT_MAX,
  parsePhone,
  phoneCallingCode,
  type PhoneCountry,
  phoneParts,
} from "@mustawfi/kernel";
import type { Ref } from "react";
import { Select, type SelectOption } from "./select.tsx";
import { TextInput } from "./text-input.tsx";

/** A phone number as it is being typed: the region it is read in, and the number as typed. */
export interface PhoneValue {
  readonly country: PhoneCountry;
  readonly number: string;
}

/** An empty phone, read in Syria until the user picks another country code. */
export const EMPTY_PHONE: PhoneValue = { country: DEFAULT_PHONE_COUNTRY, number: "" };

/** A stored E.164 number ready for editing; text that is no real number is kept as typed. */
export function phoneValue(stored: string): PhoneValue {
  const parts = phoneParts(stored);
  return parts === undefined
    ? { country: DEFAULT_PHONE_COUNTRY, number: stored }
    : { country: parts.country, number: parts.national };
}

/** `+963`, isolated left to right so it keeps its `+` in front inside Arabic text. */
function callingCode(country: PhoneCountry): string {
  return `⁦+${phoneCallingCode(country)}⁩`;
}

let options: readonly SelectOption<PhoneCountry>[] | undefined;

/**
 * Each region's calling code, named in the app's language: Syria first, then by name. Built
 * once, with one collator: every phone field shares the list.
 */
function countryOptions(): readonly SelectOption<PhoneCountry>[] {
  if (options !== undefined) return options;
  const names = new Intl.DisplayNames([LOCALE], { type: "region" });
  const collator = new Intl.Collator(LOCALE);
  const named = PHONE_COUNTRIES.map((country) => ({
    id: country,
    name: names.of(country) ?? country,
  }));
  named.sort((a, b) =>
    a.id === DEFAULT_PHONE_COUNTRY
      ? -1
      : b.id === DEFAULT_PHONE_COUNTRY
        ? 1
        : collator.compare(a.name, b.name),
  );
  options = named.map(({ id, name }) => ({ id, label: `${name} ${callingCode(id)}` }));
  return options;
}

export interface PhoneFieldProps {
  readonly label: string;
  /** The country code picker's label («رمز الدولة»). */
  readonly countryLabel: string;
  readonly value: PhoneValue;
  readonly onChange: (value: PhoneValue) => void;
  readonly onBlur?: () => void;
  readonly description?: string | undefined;
  /** Shown, and the number marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly name?: string;
  readonly className?: string;
}

/**
 * A phone number with its country code (`core-foundation` slice 21): the number as people type
 * it, read in the chosen country (Syria, `+963`, by default), and the code beside it. Leaving
 * the number groups it (`0944 123 456`); a number typed with its own code (`+961…`, `00961…`)
 * moves the picker to that country. The number reads left to right. Whether it is a real number
 * is the form's schema's to say (`parsePhone`), through `errorMessage`.
 */
export function PhoneField({
  label,
  countryLabel,
  value,
  onChange,
  onBlur,
  description,
  errorMessage,
  inputRef,
  name,
  className,
}: PhoneFieldProps) {
  const countries = countryOptions();
  return (
    <div className={className === undefined ? "flex items-start gap-2" : className}>
      <TextInput
        label={label}
        className="min-w-0 flex-1"
        value={value.number}
        onChange={(number) => {
          onChange({ ...value, number });
        }}
        onBlur={() => {
          const number = parsePhone(value.number, value.country);
          const parts = number === undefined ? undefined : phoneParts(number);
          if (
            parts !== undefined &&
            (parts.country !== value.country || parts.national !== value.number)
          ) {
            onChange({ country: parts.country, number: parts.national });
          }
          onBlur?.();
        }}
        description={description}
        errorMessage={errorMessage}
        {...(inputRef === undefined ? {} : { inputRef })}
        {...(name === undefined ? {} : { name })}
        maxLength={PHONE_TEXT_MAX}
        dir="ltr"
        type="tel"
        inputMode="tel"
        autoComplete="off"
      />
      <Select
        label={countryLabel}
        className="w-44 shrink-0"
        options={countries}
        value={value.country}
        onChange={(country) => {
          onChange({ ...value, country });
        }}
      />
    </div>
  );
}
