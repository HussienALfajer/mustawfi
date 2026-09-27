import {
  type CountryCode,
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} from "libphonenumber-js/max";
import { z } from "zod";

/**
 * Phone numbers (`core-foundation` slice 21): typed with a country code, checked as real
 * numbers against libphonenumber's full metadata (the `max` build: the number's length and
 * pattern for its country and type, not only its length), stored in E.164 (`+963944123456`),
 * and shown grouped (`+963 944 123 456`). The same rules serve the store profile now and
 * customers and suppliers later, on the client and the server.
 */

/** An ISO 3166-1 alpha-2 region libphonenumber knows. */
export type PhoneCountry = CountryCode;

/** Numbers typed without a country code are Syrian. */
export const DEFAULT_PHONE_COUNTRY: PhoneCountry = "SY";

/** Every region with a calling code, in libphonenumber's order. */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = getCountries();

/** The longest text accepted as one phone number, spaces and punctuation included. */
export const PHONE_TEXT_MAX = 40;

const E164 = /^\+[1-9][0-9]{1,14}$/;

/** Whether `text` has the shape of an E.164 number (not whether the number is real). */
export function isE164(text: string): boolean {
  return E164.test(text);
}

/** `country`'s calling code without the `+`: `"963"` for Syria. */
export function phoneCallingCode(country: PhoneCountry): string {
  return getCountryCallingCode(country);
}

/** Whether `code` is a region libphonenumber knows. */
export function isPhoneCountry(code: string): code is PhoneCountry {
  return (PHONE_COUNTRIES as readonly string[]).includes(code);
}

/**
 * The E.164 form of a number typed as people write it — national (`0944 123 456`, read in
 * `country`) or international (`+961 3 123 456`, `00963…`, whatever `country` says) — or
 * `undefined` when it is not a real number.
 */
export function parsePhone(
  text: string,
  country: PhoneCountry = DEFAULT_PHONE_COUNTRY,
): string | undefined {
  if (text.length > PHONE_TEXT_MAX) return undefined;
  const parsed = parsePhoneNumberFromString(text, country);
  return parsed?.isValid() === true ? parsed.number : undefined;
}

/** A stored number grouped for reading (`+963 944 123 456`); text that does not parse as is. */
export function formatPhone(stored: string): string {
  return parsePhoneNumberFromString(stored)?.formatInternational() ?? stored;
}

/**
 * A stored number split for editing: its region and its national form grouped
 * (`SY`, `0944 123 456`), or `undefined` when it is not a real number (a row written before
 * slice 21 that could not be read as one).
 */
export function phoneParts(
  stored: string,
): { readonly country: PhoneCountry; readonly national: string } | undefined {
  const parsed = parsePhoneNumberFromString(stored);
  if (parsed?.isValid() !== true) return undefined;
  const country =
    parsed.country ??
    PHONE_COUNTRIES.find(
      (candidate) => getCountryCallingCode(candidate) === parsed.countryCallingCode,
    );
  if (country === undefined) return undefined;
  return { country, national: parsed.formatNational() };
}

/**
 * A phone number as an API takes it, in E.164 once parsed: international, or national in
 * `DEFAULT_PHONE_COUNTRY`. A number that is not real is refused.
 */
export const phoneNumberSchema = z
  .string()
  .trim()
  .max(PHONE_TEXT_MAX)
  .transform((text, context) => {
    const number = parsePhone(text);
    if (number === undefined) {
      context.addIssue({ code: "custom", message: "not a valid phone number" });
      return z.NEVER;
    }
    return number;
  });
