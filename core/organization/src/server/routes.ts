import { type RouteAccess, type Session, sessionOf } from "@mustawfi/core-access/server";
import { ProblemError } from "@mustawfi/core-config/server";
import { problemDetailsSchema } from "@mustawfi/core-config/shared";
import { listDepartments, type TenantTransaction } from "@mustawfi/core-tenancy/server";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  departmentRenameSchema,
  departmentSchema,
  logoUploadSchema,
  newDepartmentSchema,
  organizationProblemCodes,
  storeProfileInputSchema,
  storeProfileSchema,
} from "../shared/index.ts";
import type { OrganizationContext } from "./dependencies.ts";
import {
  type Actor,
  addDepartment,
  changeDepartmentName,
  retireDepartment,
} from "./departments.ts";
import {
  editStoreProfile,
  removeStoreLogo,
  setStoreLogo,
  storeLogo,
  storeProfile,
} from "./store-profile.ts";

const tags = ["organization"];

const departmentParamsSchema = z.object({ id: z.uuid() });

const refusals = {
  401: problemDetailsSchema,
  403: problemDetailsSchema,
  404: problemDetailsSchema,
  409: problemDetailsSchema,
  422: problemDetailsSchema,
};

/**
 * Reads are open to every signed-in user: the POS shows the store name, and pickers list
 * departments (`core-foundation` slice 5).
 */
const read: { readonly access: RouteAccess } = { access: "session" };
const manageDepartments: { readonly access: RouteAccess } = {
  access: { permission: "organization.departments.manage" },
};
const editProfile: { readonly access: RouteAccess } = {
  access: { permission: "organization.profile.edit" },
};

/**
 * `core.organization` routes, under `/api/v1/organization`: departments (stored by
 * `core.tenancy`, ADR-0030) and the store profile. Every query runs under the session's tenant.
 */
export function organizationRoutes(scope: FastifyInstance, context: OrganizationContext): void {
  const app = scope.withTypeProvider<ZodTypeProvider>();

  /** Runs `fn` in the session's tenant with the session's user as the actor. */
  function asActor<T>(
    session: Session,
    fn: (tx: TenantTransaction, actor: Actor) => Promise<T>,
  ): Promise<T> {
    const actor: Actor = {
      tenantId: session.tenantId,
      branchId: session.branchId,
      userId: session.user.id,
      ...(session.deviceId === null ? {} : { deviceId: session.deviceId }),
      at: context.clock.now(),
    };
    return context.tenants.withTenant(
      { tenantId: session.tenantId, userId: session.user.id },
      (tx) => fn(tx, actor),
    );
  }

  app.get(
    "/departments",
    {
      config: read,
      schema: {
        tags,
        response: {
          200: z.object({ items: z.array(departmentSchema) }),
          401: problemDetailsSchema,
        },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      const items = await asActor(session, (tx) => listDepartments(tx));
      return { items };
    },
  );

  app.post(
    "/departments",
    {
      config: manageDepartments,
      schema: { tags, body: newDepartmentSchema, response: { 201: departmentSchema, ...refusals } },
    },
    async (request, reply) => {
      const session = sessionOf(request);
      const department = await asActor(session, (tx, actor) =>
        addDepartment(tx, actor, request.body.name, context),
      );
      return reply.status(201).send(department);
    },
  );

  app.patch(
    "/departments/:id",
    {
      config: manageDepartments,
      schema: {
        tags,
        params: departmentParamsSchema,
        body: departmentRenameSchema,
        response: { 200: departmentSchema, ...refusals },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      return asActor(session, (tx, actor) =>
        changeDepartmentName(
          tx,
          actor,
          { id: request.params.id, name: request.body.name },
          context,
        ),
      );
    },
  );

  app.post(
    "/departments/:id/archive",
    {
      config: manageDepartments,
      schema: {
        tags,
        params: departmentParamsSchema,
        response: { 200: departmentSchema, ...refusals },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      return asActor(session, (tx, actor) =>
        retireDepartment(tx, actor, request.params.id, context),
      );
    },
  );

  app.get(
    "/profile",
    {
      config: read,
      schema: { tags, response: { 200: storeProfileSchema, 401: problemDetailsSchema } },
    },
    async (request) => {
      const session = sessionOf(request);
      return asActor(session, (tx) => storeProfile(tx));
    },
  );

  app.put(
    "/profile",
    {
      config: editProfile,
      schema: {
        tags,
        body: storeProfileInputSchema,
        response: { 200: storeProfileSchema, ...refusals },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      return asActor(session, (tx, actor) => editStoreProfile(tx, actor, request.body, context));
    },
  );

  app.put(
    "/profile/logo",
    {
      config: editProfile,
      schema: {
        tags,
        body: logoUploadSchema,
        response: { 200: storeProfileSchema, ...refusals },
      },
    },
    async (request) => {
      const session = sessionOf(request);
      const bytes = new Uint8Array(Buffer.from(request.body.data, "base64"));
      return asActor(session, (tx, actor) => setStoreLogo(tx, actor, bytes, context));
    },
  );

  app.delete(
    "/profile/logo",
    {
      config: editProfile,
      schema: { tags, response: { 200: storeProfileSchema, ...refusals } },
    },
    async (request) => {
      const session = sessionOf(request);
      return asActor(session, (tx, actor) => removeStoreLogo(tx, actor, context));
    },
  );

  app.get(
    "/profile/logo",
    // The image bytes, as stored; refusals are problem details like everywhere else.
    { config: read, schema: { tags } },
    async (request, reply) => {
      const session = sessionOf(request);
      const logo = await asActor(session, (tx) => storeLogo(tx));
      if (logo === undefined) {
        throw new ProblemError(organizationProblemCodes.logoNotFound, 404, {
          title: "The store has no logo",
        });
      }
      return reply.type(logo.type).send(Buffer.from(logo.bytes));
    },
  );
}
