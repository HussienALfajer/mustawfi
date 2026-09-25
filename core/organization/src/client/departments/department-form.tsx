import { zodResolver } from "@hookform/resolvers/zod";
import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { accessProblemCodes } from "@mustawfi/core-access/shared";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import { Badge, Button, ConfirmDialog, Kbd, SidePanel, TextInput, useShortcut } from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { type DepartmentView, newDepartmentSchema } from "../../shared/index.ts";
import { ORGANIZATION_NAMESPACE } from "../messages.ts";
import {
  archiveDepartment,
  createDepartment,
  departmentsQueryKey,
  renameDepartment,
} from "./queries.ts";

type DepartmentForm = { name: string };

/** The message key of a refusal, under `departments.problem.`. */
export function departmentProblem(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case tenancyProblemCodes.departmentNameTaken:
      return "nameTaken";
    case tenancyProblemCodes.departmentLimit:
      return "limit";
    case tenancyProblemCodes.lastActiveDepartment:
      return "lastActive";
    case tenancyProblemCodes.defaultDepartment:
      return "default";
    case tenancyProblemCodes.departmentArchived:
      return "archived";
    case tenancyProblemCodes.departmentNotFound:
      return "notFound";
    case accessProblemCodes.ownerRequired:
      return "ownerRequired";
    default:
      return "refused";
  }
}

export interface DepartmentPanelProps {
  /** The department shown, or `null` for a new one. */
  readonly department: DepartmentView | null;
  readonly onClose: () => void;
  /** After a save: the department as the server answered. */
  readonly onSaved: (department: DepartmentView) => void;
}

/**
 * A department in the side panel: add one, rename it, or archive it (confirmed once). The name
 * is checked with the server's own schema; a refusal is said on the panel, never only in a toast.
 */
export function DepartmentPanel({ department, onClose, onSaved }: DepartmentPanelProps) {
  const { t } = useTranslation(ORGANIZATION_NAMESPACE);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState<string | undefined>();
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
      setNotice(
        t(department === null ? "departments.panel.added" : "departments.panel.saved", {
          name: saved.name,
        }),
      );
      form.reset({ name: saved.name });
      await queryClient.invalidateQueries({ queryKey: departmentsQueryKey });
      onSaved(saved);
    },
    onError: (error) => {
      if (departmentProblem(error) === "nameTaken") {
        form.setError("name", { type: "nameTaken" }, { shouldFocus: true });
      }
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveDepartment(id),
    onSuccess: async (saved) => {
      setConfirming(false);
      setNotice(t("departments.archive.done", { name: saved.name }));
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
  // The shared schema's issue codes, or the server's refusal of a taken name.
  const nameKey =
    nameError === undefined
      ? undefined
      : nameError.type === "nameTaken"
        ? "nameTaken"
        : nameError.type === "too_big"
          ? "nameTooLong"
          : "nameRequired";
  const fieldError = nameKey === undefined ? undefined : t(`departments.problem.${nameKey}`);
  const failure = [save.error, archive.error]
    .filter((error) => error !== null)
    .map((error) => departmentProblem(error))
    .find((problem) => problem !== "nameTaken");

  return (
    <SidePanel
      title={department?.name ?? t("departments.panel.newTitle")}
      closeLabel={t("departments.panel.close")}
      onClose={onClose}
      footer={
        archived ? undefined : (
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
          setNotice(undefined);
          save.reset();
          archive.reset();
          void form.handleSubmit((values) => {
            save.mutate(values);
          })(event);
        }}
        className="flex flex-col gap-4"
      >
        {department === null ? null : (
          <div className="flex gap-2">
            {archived ? (
              <Badge tone="neutral">{t("departments.state.archived")}</Badge>
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
          <p role="alert" className="text-text-negative">
            {t(`departments.problem.${failure}`)}
          </p>
        )}
        <p role="status" className="text-text-positive min-h-5">
          {notice}
        </p>
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
            setNotice(undefined);
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
