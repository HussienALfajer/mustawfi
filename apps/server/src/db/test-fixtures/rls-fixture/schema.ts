import { pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** A tenant-owned table built the way every module builds its tables (ADR-0016, ADR-0017). */
export const rlsFixture = pgSchema("rls_fixture");

export const items = rlsFixture.table("items", {
  id: uuid().primaryKey(),
  tenantId: uuid().notNull(),
  branchId: uuid().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull(),
  createdBy: uuid().notNull(),
  name: text().notNull(),
});
