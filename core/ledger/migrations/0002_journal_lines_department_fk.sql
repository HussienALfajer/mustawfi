-- Custom SQL migration file, put your code below! --
-- A line's department is one of its own tenant's departments (core-foundation slice 4). The
-- foreign key is tenant-scoped: a plain one would bypass row-level security in its check.
ALTER TABLE "core_ledger"."journal_lines" ADD CONSTRAINT "journal_lines_department_fk"
  FOREIGN KEY ("tenant_id", "department_id")
  REFERENCES "core_tenancy"."departments"("tenant_id", "id");
