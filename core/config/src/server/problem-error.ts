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

  constructor(
    code: string,
    status: number,
    options: { title?: string; detail?: string; cause?: unknown } = {},
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
  }
}
