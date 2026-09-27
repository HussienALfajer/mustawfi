import { problemCodeSchema } from "../shared/problem.ts";

/**
 * A business refusal: an expected outcome with a stable code and a 4xx status, which the host
 * renders as problem details (ADR-0014). Anything else thrown is an unexpected failure (500).
 */
export class ProblemError extends Error {
  override name = "ProblemError";
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly detail: string | undefined;
  /** Seconds to wait before trying again, sent as `Retry-After` (a 429's, RFC 9110). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: string,
    status: number,
    options: { title?: string; detail?: string; cause?: unknown; retryAfterSeconds?: number } = {},
  ) {
    super(options.detail ?? options.title ?? code, { cause: options.cause });
    problemCodeSchema.parse(code);
    if (!Number.isInteger(status) || status < 400 || status > 499) {
      throw new RangeError(`a business refusal has a 4xx status, got ${status}`);
    }
    this.code = code;
    this.status = status;
    this.title = options.title ?? code;
    this.detail = options.detail;
    const wait = options.retryAfterSeconds;
    if (wait !== undefined && (!Number.isInteger(wait) || wait < 1)) {
      throw new RangeError(`Retry-After is a whole number of seconds from 1, got ${String(wait)}`);
    }
    this.retryAfterSeconds = wait;
  }
}
