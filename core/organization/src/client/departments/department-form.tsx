import { zodResolver } from "@hookform/resolvers/zod";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { nameKey, VERTEX_SUPPORT_WHATSAPP } from "@mustawfi/core-config/shared";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { type AuditLink, LastChangeLine } from "@mustawfi/core-audit/client";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import {
  Badge,
  Button,
  ConfirmDialog,
  Kbd,
  SidePanel,
  SupportContact,
  TextInput,
  useShortcut,
  useToast,
} from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import {
  type DepartmentListItem,
  type DepartmentView,
  newDepartmentSchema,
} from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import {
  archiveDepartment,
  createDepartment,
  departmentsQueryKey,
  renameDepartment,
  restoreDepartment,
} from "./queries.ts";

type DepartmentForm = { name: string };

/** The message key of a refusal, under `departments.problem.`. */
export function departmentProblem(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case tenancyProblemCodes.departmentNameTaken:
      return "nameTaken";
    case tenancyProblemCodes.departmentNameArchived:
      return "nameArchived";
    case tenancyProblemCodes.departmentLimit:
      return "limit";
    case tenancyProblemCodes.lastActiveDepartment:
      return "lastActive";
    case tenancyProblemCodes.defaultDepartment:
      return "default";
    case tenancyProblemCodes.departmentArchived:
      return "archived";
    case tenancyProblemCodes.departmentNotArchived:
      return "notArchived";
    case tenancyProblemCodes.departmentNotFound:
      return "notFound";
    case tenancyProblemCodes.licenseReadOnly:
      return "readOnly";
    case accessProblemCodes.permissionDenied:
      return "permissionDenied";
    default:
      return "refused";
  }
}

/** Refusals said on the name field rather than under the form. */
const NAME_PROBLEMS = new Set(["nameTaken", "nameArchived"]);

export interface DepartmentPanelProps {
  /** The department shown, or `null` for a new one. */
  readonly department: DepartmentListItem | null;
  /** Every department of the store, archived ones included: a new name is checked against them. */
  readonly departments: readonly DepartmentListItem[];
  readonly onClose: () => void;
  /** After a save: the department as the server answered. */
  readonly onSaved: (department: DepartmentView) => void;
  /** After a restore — of this department, or of the archived one a new name matched. */
  readonly onRestored: (department: DepartmentView) => void;
  /** The last line's link to the record's history, for readers of the audit log. */
  readonly auditLink?: AuditLink | undefined;
}

/**
 * A department in the side panel: add one, rename it, archive it (confirmed once), or restore an
 * archived one (no confirmation: nothing is lost either way). The name is checked with the
 * server's own schema; typing an archived department's name for a new one offers to restore
 * that one instead (`core-foundation` slice 20). A refusal is said on the panel, never only in a
 * toast. The panel ends with its last change.
 */
export function DepartmentPanel({
  department,
  departments,
  onClose,
  onSaved,
  onRestored,
  auditLink,
}: DepartmentPanelProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const archived = department !== null && department.archivedAt !== null;
  const form = useForm<DepartmentForm>({
    resolver: zodResolver(newDepartmentSchema),
    defaultValues: { name: department?.name ?? "" },
  });
  const save = useMutation({
    mutationFn: (values: DepartmentForm) =>
      department === null
        ? createDepartment(values.name)
        : renameDepartment(department.id, values.name),
    onSuccess: async (saved) => {
      toast.show(
        t(department === null ? "departments.panel.added" : "departments.panel.saved", {
          name: saved.name,
        }),
      );
      form.reset({ name: saved.name });
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey });
      onSaved(saved);
    },
    onError: (error) => {
      const problem = departmentProblem(error);
      if (NAME_PROBLEMS.has(problem)) {
        form.setError("name", { type: problem }, { shouldFocus: true });
      }
    },
  });
  const restore = useMutation({
    mutationFn: (id: string) => restoreDepartment(id),
    onSuccess: async (restored) => {
      toast.show(t("departments.restore.done", { name: restored.name }));
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey });
      onRestored(restored);
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveDepartment(id),
    onSuccess: async (saved) => {
      setConfirming(false);
      toast.show(t("departments.archive.done", { name: saved.name }));
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey });
      onSaved(saved);
    },
    onError: () => {
      setConfirming(false);
    },
  });
  useShortcut({ key: "s", ctrl: true }, () => {
    if (!archived) formRef.current?.requestSubmit();
  });

  const nameError = form.formState.errors.name;
  // The shared schema's issue codes, or the server's refusal of a name another department has.
  const errorKey =
    nameError === undefined
      ? undefined
      : NAME_PROBLEMS.has(nameError.type)
        ? nameError.type
        : nameError.type === "too_big"
          ? "nameTooLong"
          : "nameRequired";
  const fieldError = errorKey === undefined ? undefined : t(`departments.problem.${errorKey}`);
  const failure = [save.error, archive.error, restore.error]
    .filter((error) => error !== null)
    .map((error) => departmentProblem(error))
    .find((problem) => !NAME_PROBLEMS.has(problem));
  // An archived department with the name typed for a new one: restoring it is offered instead.
  const typed = useWatch({ control: form.control, name: "name" });
  const archivedMatch =
    department === null && nameKey(typed) !== ""
      ? departments.find((d) => d.archivedAt !== null && nameKey(d.name) === nameKey(typed))
      : undefined;

  return (
    <SidePanel
      title={department?.name ?? t("departments.panel.newTitle")}
      closeLabel={t("departments.panel.close")}
      onClose={onClose}
      footer={
        archived ? (
          <Button
            isPending={restore.isPending}
            onPress={() => {
              restore.mutate(department.id);
            }}
          >
            {t("departments.panel.restore")}
          </Button>
        ) : (
          <>
            <Button
              aria-keyshortcuts="Control+S"
              isPending={save.isPending}
              onPress={() => formRef.current?.requestSubmit()}
            >
              {t(department === null ? "departments.panel.add" : "departments.panel.save")}
              <Kbd shortcut="Control+S" />
            </Button>
            {department === null || department.isDefault ? null : (
              <Button
                variant="danger"
                className="ms-auto"
                onPress={() => {
                  setConfirming(true);
                }}
              >
                {t("departments.panel.archive")}
              </Button>
            )}
          </>
        )
      }
    >
      <form
        ref={formRef}
        noValidate
        onSubmit={(event) => {
          save.reset();
          archive.reset();
          restore.reset();
          void form.handleSubmit((values) => {
            save.mutate(values);
          })(event);
        }}
        className="flex flex-col gap-4"
      >
        {department === null ? null : (
          <div className="flex gap-2">
            {archived ? (
              <Badge tone="archived">{t("departments.state.archived")}</Badge>
            ) : (
              <Badge tone="positive">{t("departments.state.active")}</Badge>
            )}
            {department.isDefault ? <Badge tone="info">{t("departments.default")}</Badge> : null}
          </div>
        )}
        <Controller
          control={form.control}
          name="name"
          render={({ field }) => (
            <TextInput
              label={`${t("departments.panel.name")} ${t("departments.panel.required")}`}
              description={department === null ? t("departments.panel.nameHelp") : undefined}
              errorMessage={fieldError}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              inputRef={field.ref}
              name={field.name}
              isReadOnly={archived}
              autoFocus={department === null}
              autoComplete="off"
            />
          )}
        />
        <div role="status">
          {archivedMatch === undefined ? null : (
            <div className="flex flex-col items-start gap-2 rounded-sm bg-sunken px-3 py-2">
              <p className="text-sm text-text">
                {t("departments.restore.offer", { name: archivedMatch.name })}
              </p>
              <Button
                variant="secondary"
                isPending={restore.isPending}
                onPress={() => {
                  save.reset();
                  restore.mutate(archivedMatch.id);
                }}
              >
                {t("departments.restore.action", { name: archivedMatch.name })}
              </Button>
            </div>
          )}
        </div>
        {department === null ? (
          <p className="rounded-sm bg-sunken px-3 py-2 text-sm text-text-secondary">
            {t("departments.panel.firstExtraNote")}
          </p>
        ) : null}
        {department?.isDefault === true ? (
          <p className="rounded-sm bg-sunken px-3 py-2 text-sm text-text-secondary">
            {t("departments.panel.defaultNote")}
          </p>
        ) : null}
        {archived ? (
          <p className="rounded-sm bg-sunken px-3 py-2 text-sm text-text-secondary">
            {t("departments.panel.archivedNote")}
          </p>
        ) : null}
        {failure === undefined ? null : (
          <div className="flex flex-col gap-2">
            <p role="alert" className="text-text-negative">
              {t(`departments.problem.${failure}`)}
            </p>
            {/* A larger plan comes from Vertex (M6 decision). */}
            {failure === "limit" ? <SupportContact whatsapp={VERTEX_SUPPORT_WHATSAPP} /> : null}
          </div>
        )}
        {department === null ? null : (
          <LastChangeLine
            entityId={department.id}
            lastChange={department.lastChange}
            auditLink={auditLink}
          />
        )}
      </form>
      {department === null ? null : (
        <ConfirmDialog
          isOpen={confirming}
          onOpenChange={setConfirming}
          title={t("departments.archive.title", { name: department.name })}
          confirmLabel={t("departments.archive.confirm")}
          cancelLabel={t("departments.archive.cancel")}
          isPending={archive.isPending}
          onConfirm={() => {
            save.reset();
            archive.mutate(department.id);
          }}
        >
          {t("departments.archive.body")}
        </ConfirmDialog>
      )}
    </SidePanel>
  );
}
