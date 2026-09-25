import { documentCodeSchema } from "@mustawfi/core-config/shared";

/** A device prefix: two symbols of the unambiguous alphabet (ADR-0020, ADR-0022). */
const DEVICE_PREFIX = /^[A-HJ-NP-Z2-9]{2}$/;

const DOCUMENT_NUMBER = /^([A-HJ-NP-Z2-9]{2})-([A-Z]{3})-(\d{6,15})$/;

/** A document number read back: the device's prefix, the document code, and the sequence. */
export interface DocumentNumber {
  readonly prefix: string;
  readonly docCode: string;
  readonly seq: number;
}

/**
 * A document number, `{prefix}-{docCode}-{seq:6}` (ADR-0020, `core-foundation` rule 30): the
 * device's prefix, the code its module declared, and the device's sequence for that code,
 * zero-padded to six digits and longer beyond 999999. The one place numbers are made.
 */
export function formatDocumentNumber(prefix: string, docCode: string, seq: number): string {
  if (!DEVICE_PREFIX.test(prefix)) throw new TypeError(`"${prefix}" is not a device prefix`);
  if (!documentCodeSchema.safeParse(docCode).success) {
    throw new TypeError(`"${docCode}" is not a document code`);
  }
  if (!Number.isSafeInteger(seq) || seq < 1 || seq >= 10 ** 15) {
    throw new RangeError(`a document sequence is a positive integer, got ${String(seq)}`);
  }
  return `${prefix}-${docCode}-${String(seq).padStart(6, "0")}`;
}

/**
 * The prefix, code, and sequence of a number in its one canonical form, or `undefined`: a
 * number with extra leading zeros, a zero sequence, or any other spelling is not a number.
 */
export function parseDocumentNumber(number: string): DocumentNumber | undefined {
  const match = DOCUMENT_NUMBER.exec(number);
  if (match === null) return undefined;
  const [, prefix = "", docCode = "", digits = ""] = match;
  const seq = Number.parseInt(digits, 10);
  if (seq < 1 || formatDocumentNumber(prefix, docCode, seq) !== number) return undefined;
  return { prefix, docCode, seq };
}
