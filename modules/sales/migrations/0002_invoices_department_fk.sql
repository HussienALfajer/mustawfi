-- Custom SQL migration file, put your code below! --
-- An invoice's department is one of its own tenant's departments (core-foundation slice 4). The
-- foreign key is tenant-scoped: a plain one would bypass row-level security in its check.
ALTER TABLE "sales"."invoices" ADD CONSTRAINT "invoices_department_fk"
  FOREIGN KEY ("tenant_id", "department_id")
  REFERENCES "core_tenancy"."departments"("tenant_id", "id");
