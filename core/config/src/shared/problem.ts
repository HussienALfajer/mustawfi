import { z } from "zod";

/**
 * A stable machine code, `module.subject.reason` in camelCase segments
 * (`inventory.product.barcodeTaken`). Clients turn it into an Arabic message through i18n
 * (ADR-0014); a code never changes once released.
 */
export const problemCodeSchema = z
  .string()
  .regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, "a problem code is dotted camelCase");

/** One invalid field of a request, for `core.request.invalid`. */
export const problemFieldErrorSchema = z.object({
  /** Where the field is, e.g. `body/name`. */
  path: z.string(),
  message: z.string(),
});

/** RFC 9457 problem details with the `code` extension every error response carries. */
export const problemDetailsSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int().min(400).max(599),
    code: problemCodeSchema,
    detail: z.string().optional(),
    instance: z.string().optional(),
    errors: z.array(problemFieldErrorSchema).optional(),
  })
  .meta({ id: "ProblemDetails" });

export type ProblemDetails = z.infer<typeof problemDetailsSchema>;

/** The codes the server host itself produces; modules add their own under their id. */
export const hostProblemCodes = {
  invalidRequest: "core.request.invalid",
  rejectedRequest: "core.request.rejected",
  routeNotFound: "core.route.notFound",
  internal: "core.server.internal",
} as const;
