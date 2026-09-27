import { hostProblemCodes, type ProblemDetails } from "@mustawfi/core-config/shared";
import { ProblemError } from "@mustawfi/core-config/server";
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from "fastify-type-provider-zod";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";

function send(reply: FastifyReply, problem: ProblemDetails): FastifyReply {
  return reply.status(problem.status).type(PROBLEM_CONTENT_TYPE).send(problem);
}

/**
 * Every error leaves the server as RFC 9457 problem details with a stable `code` (ADR-0014):
 * a business refusal (`ProblemError`) with its own code and status; an invalid request as
 * `core.request.invalid` with the failing fields; any other client error Fastify raises as
 * `core.request.rejected`; everything else as a 500 that is logged and says nothing more.
 *
 * The statuses (settled in `core-foundation` QA slice 26): 400 for a request its route's schema
 * refuses — shape, format, bounds; 401 and 403 for access; 404 for a record the tenant does not
 * have; 409 for a conflict with the current state (a taken name, a reached limit); 422 for a
 * well-formed request a business rule refuses.
 */
export function problemErrorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const instance = request.url;
  if (error instanceof ProblemError) {
    if (error.retryAfterSeconds !== undefined) {
      void reply.header("retry-after", String(error.retryAfterSeconds));
    }
    return send(reply, {
      type: "about:blank",
      title: error.title,
      status: error.status,
      code: error.code,
      ...(error.detail === undefined ? {} : { detail: error.detail }),
      instance,
    });
  }
  if (hasZodFastifySchemaValidationErrors(error)) {
    return send(reply, {
      type: "about:blank",
      title: "The request is invalid",
      status: 400,
      code: hostProblemCodes.invalidRequest,
      instance,
      errors: error.validation.map((issue) => ({
        path: [error.validationContext, issue.instancePath.replace(/^\//, "")]
          .filter((part) => part !== undefined && part !== "")
          .join("/"),
        message: issue.message ?? "invalid",
      })),
    });
  }
  const status = error.statusCode;
  if (
    !isResponseSerializationError(error) &&
    status !== undefined &&
    status >= 400 &&
    status < 500
  ) {
    return send(reply, {
      type: "about:blank",
      title: "The request was rejected",
      status,
      code: hostProblemCodes.rejectedRequest,
      detail: error.message,
      instance,
    });
  }
  request.log.error({ err: error }, "unexpected failure");
  return send(reply, {
    type: "about:blank",
    title: "Internal server error",
    status: 500,
    code: hostProblemCodes.internal,
    instance,
  });
}

export function problemNotFoundHandler(request: FastifyRequest, reply: FastifyReply) {
  return send(reply, {
    type: "about:blank",
    title: "No such route",
    status: 404,
    code: hostProblemCodes.routeNotFound,
    instance: request.url,
  });
}
