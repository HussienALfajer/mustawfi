import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { limitValueSchema } from "@mustawfi/core-config/shared";
import {
  Badge,
  Button,
  Checkbox,
  ConfirmDialog,
  Kbd,
  SidePanel,
  TextInput,
  useShortcut,
} from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { accessProblemCodes, roleNameSchema, type RoleView } from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import { limitLabelKey, moduleNamespace, permissionLabelKey } from "../permission-labels.ts";
import {
  archiveRole,
  createRole,
  type PermissionCatalogueView,
  rolesQueryKey,
  updateRole,
} from "./queries.ts";

/** The message key of a refusal, under `roles.problem.`. */
export function roleProblem(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case accessProblemCodes.roleNameTaken:
      return "nameTaken";
    case accessProblemCodes.roleInvalid:
      return "roleInvalid";
    case accessProblemCodes.ownerRoleFixed:
      return "ownerFixed";
    case accessProblemCodes.roleInUse:
      return "inUse";
    case accessProblemCodes.roleArchived:
      return "archived";
    case accessProblemCodes.roleNotFound:
      return "notFound";
    case accessProblemCodes.beyondOwnGrant:
      return "beyondOwnGrant";
    case accessProblemCodes.permissionDenied:
      return "permissionDenied";
    default:
      return "refused";
  }
}

/** One module's part of the matrix: its permissions and limits, in the catalogue's order. */
export interface MatrixGroup {
  readonly moduleId: string;
  readonly permissions: PermissionCatalogueView["permissions"];
  readonly limits: PermissionCatalogueView["limits"];
}

/** The catalogue grouped by declaring module, modules in the order they first appear. */
export function matrixGroups(catalogue: PermissionCatalogueView): MatrixGroup[] {
  const groups = new Map<
    string,
    { permissions: MatrixGroup["permissions"]; limits: MatrixGroup["limits"] }
  >();
  const group = (moduleId: string) => {
    let found = groups.get(moduleId);
    if (found === undefined) {
      found = { permissions: [], limits: [] };
      groups.set(moduleId, found);
    }
    return found;
  };
  for (const permission of catalogue.permissions)
    group(permission.moduleId).permissions.push(permission);
  for (const limit of catalogue.limits) group(limit.moduleId).limits.push(limit);
  return [...groups].map(([moduleId, parts]) => ({ moduleId, ...parts }));
}

interface RoleDraft {
  readonly name: string;
  readonly permissions: ReadonlySet<string>;
  readonly limits: Readonly<Record<string, string>>;
}

function draftOf(role: RoleView | null, copyName?: string): RoleDraft {
  return {
    name: copyName ?? role?.name ?? "",
    permissions: new Set(role?.permissions ?? []),
    limits: { ...role?.limits },
  };
}

export interface RolePanelProps {
  /** The role shown, or `null` for a new one. */
  readonly role: RoleView | null;
  /** A new role starts as a copy of this one (its permissions and limits). */
  readonly source?: RoleView | undefined;
  readonly catalogue: PermissionCatalogueView;
  /** Whether the signed-in user holds `access.roles.manage`. */
  readonly canManage: boolean;
  readonly onClose: () => void;
  readonly onSaved: (role: RoleView) => void;
  /** Opens a new panel that copies `role`. */
  readonly onCopy: (role: RoleView) => void;
}

/**
 * A role in the side panel: its name and the permission matrix, grouped by the module that
 * declares each permission, with the limits under their module. The owner role and archived
 * roles are shown read-only; a role is copied into a new panel, then saved as a new role.
 */
export function RolePanel({
  role,
  source,
  catalogue,
  canManage,
  onClose,
  onSaved,
  onCopy,
}: RolePanelProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<RoleDraft>(() =>
    draftOf(
      role ?? source ?? null,
      role === null && source !== undefined
        ? t("roles.panel.copyName", { name: source.name })
        : undefined,
    ),
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [limitErrors, setLimitErrors] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const archived = role !== null && role.archivedAt !== null;
  const readOnly = !canManage || archived || role?.isOwner === true;

  const save = useMutation({
    mutationFn: (request: {
      name: string;
      permissions: string[];
      limits: Record<string, string>;
    }) => (role === null ? createRole(request) : updateRole(role.id, request)),
    onSuccess: async (saved) => {
      setNotice(t(role === null ? "roles.panel.added" : "roles.panel.saved", { name: saved.name }));
      setDraft(draftOf(saved));
      await queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      onSaved(saved);
    },
    onError: (error) => {
      if (roleProblem(error) === "nameTaken") setNameError(t("roles.problem.nameTaken"));
    },
  });
  const archive = useMutation({
    mutationFn: (id: string) => archiveRole(id),
    onSuccess: async (saved) => {
      setConfirming(false);
      setNotice(t("roles.archive.done", { name: saved.name }));
      await queryClient.invalidateQueries({ queryKey: rolesQueryKey });
      onSaved(saved);
      // The footer leaves with an archived role; focus stays in the panel.
      nameRef.current?.focus();
    },
    onError: () => {
      setConfirming(false);
    },
  });

  const submit = () => {
    setNotice(undefined);
    save.reset();
    archive.reset();
    const name = roleNameSchema.safeParse(draft.name);
    setNameError(
      name.success
        ? undefined
        : t(
            name.error.issues[0]?.code === "too_big"
              ? "roles.problem.nameTooLong"
              : "roles.problem.nameRequired",
          ),
    );
    const limits: Record<string, string> = {};
    const badLimits = new Set<string>();
    for (const [id, value] of Object.entries(draft.limits)) {
      const trimmed = value.trim();
      if (trimmed === "") continue;
      if (limitValueSchema.safeParse(trimmed).success) limits[id] = trimmed;
      else badLimits.add(id);
    }
    setLimitErrors(badLimits);
    if (!name.success || badLimits.size > 0) return;
    const declared = new Set(catalogue.permissions.map((permission) => permission.id));
    save.mutate({
      name: name.data,
      permissions: [...draft.permissions].filter((id) => declared.has(id)),
      limits,
    });
  };
  useShortcut({ key: "s", ctrl: true }, () => {
    if (!readOnly) submit();
  });

  const failure = [save.error, archive.error]
    .filter((error) => error !== null)
    .map((error) => roleProblem(error))
    .find((problem) => problem !== "nameTaken");
  const title =
    role?.name ??
    (source === undefined
      ? t("roles.panel.newTitle")
      : t("roles.panel.copyTitle", { name: source.name }));

  return (
    <SidePanel
      title={title}
      closeLabel={t("roles.panel.close")}
      onClose={onClose}
      footer={
        !canManage || archived ? undefined : (
          <>
            {role?.isOwner === true ? null : (
              <Button aria-keyshortcuts="Control+S" isPending={save.isPending} onPress={submit}>
                {t(role === null ? "roles.panel.add" : "roles.panel.save")}
                <Kbd shortcut="Control+S" />
              </Button>
            )}
            {role === null ? null : (
              <Button
                variant="secondary"
                onPress={() => {
                  onCopy(role);
                }}
              >
                {t("roles.panel.copy")}
              </Button>
            )}
            {role === null || role.isOwner ? null : (
              <Button
                variant="danger"
                className="ms-auto"
                onPress={() => {
                  setConfirming(true);
                }}
              >
                {t("roles.panel.archive")}
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
          event.preventDefault();
          if (!readOnly) submit();
        }}
        className="flex flex-col gap-4"
      >
        {role === null ? null : (
          <div className="flex flex-wrap items-center gap-2">
            <RoleKindBadge role={role} />
            {archived ? (
              <Badge tone="neutral">{t("roles.state.archived")}</Badge>
            ) : (
              <Badge tone="positive">{t("roles.state.active")}</Badge>
            )}
            <span className="text-sm text-text-secondary">
              {t("roles.panel.activeUsers", { count: role.activeUsers })}
            </span>
          </div>
        )}
        <TextInput
          label={`${t("roles.panel.name")} ${t("roles.panel.required")}`}
          errorMessage={nameError}
          value={draft.name}
          onChange={(name) => {
            setDraft({ ...draft, name });
          }}
          inputRef={nameRef}
          isReadOnly={readOnly}
          autoFocus={role === null}
          autoComplete="off"
        />
        {role?.isOwner === true ? <Note>{t("roles.panel.ownerNote")}</Note> : null}
        {role !== null && role.template !== null && !role.isOwner ? (
          <Note>{t("roles.panel.templateNote")}</Note>
        ) : null}
        {archived ? <Note>{t("roles.panel.archivedNote")}</Note> : null}
        {!canManage ? <Note>{t("roles.panel.readOnlyNote")}</Note> : null}
        <PermissionMatrix
          catalogue={catalogue}
          draft={draft}
          readOnly={readOnly}
          limitErrors={limitErrors}
          onChange={setDraft}
        />
        {failure === undefined ? null : (
          <p role="alert" className="text-text-negative">
            {t(`roles.problem.${failure}`)}
          </p>
        )}
        <p role="status" className="min-h-5 text-text-positive">
          {notice}
        </p>
      </form>
      {role === null ? null : (
        <ConfirmDialog
          isOpen={confirming}
          onOpenChange={setConfirming}
          title={t("roles.archive.title", { name: role.name })}
          confirmLabel={t("roles.archive.confirm")}
          cancelLabel={t("roles.archive.cancel")}
          isPending={archive.isPending}
          onConfirm={() => {
            setNotice(undefined);
            save.reset();
            archive.mutate(role.id);
          }}
        >
          {t("roles.archive.body")}
        </ConfirmDialog>
      )}
    </SidePanel>
  );
}

function Note({ children }: { readonly children: string }) {
  return <p className="rounded-sm bg-sunken px-3 py-2 text-sm text-text-secondary">{children}</p>;
}

/** Owner, a template's role, or a custom one, as a word. */
export function RoleKindBadge({ role }: { readonly role: RoleView }) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  if (role.isOwner) return <Badge tone="info">{t("roles.kind.owner")}</Badge>;
  if (role.template !== null) return <Badge tone="neutral">{t("roles.kind.template")}</Badge>;
  return <Badge tone="neutral">{t("roles.kind.copy")}</Badge>;
}

function PermissionMatrix({
  catalogue,
  draft,
  readOnly,
  limitErrors,
  onChange,
}: {
  readonly catalogue: PermissionCatalogueView;
  readonly draft: RoleDraft;
  readonly readOnly: boolean;
  readonly limitErrors: ReadonlySet<string>;
  readonly onChange: (draft: RoleDraft) => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const groups = matrixGroups(catalogue);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-base font-semibold">
        {t("roles.panel.permissions")}
      </h3>
      {groups.length === 0 ? (
        <p className="text-text-secondary">{t("roles.panel.noPermissions")}</p>
      ) : null}
      {groups.map((group) => (
        <MatrixModule
          key={group.moduleId}
          group={group}
          draft={draft}
          readOnly={readOnly}
          limitErrors={limitErrors}
          onChange={onChange}
        />
      ))}
    </section>
  );
}

function MatrixModule({
  group,
  draft,
  readOnly,
  limitErrors,
  onChange,
}: {
  readonly group: MatrixGroup;
  readonly draft: RoleDraft;
  readonly readOnly: boolean;
  readonly limitErrors: ReadonlySet<string>;
  readonly onChange: (draft: RoleDraft) => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const headingId = useId();
  const ns = moduleNamespace(group.moduleId);
  return (
    <div
      role="group"
      aria-labelledby={headingId}
      className="flex flex-col rounded-sm border border-divider px-3 py-2"
    >
      <h4 id={headingId} className="text-sm font-semibold text-text-secondary">
        {t("moduleName", { ns })}
      </h4>
      {group.permissions.map((permission) => {
        const label = permissionLabelKey(permission.id);
        return (
          <Checkbox
            key={permission.id}
            isSelected={draft.permissions.has(permission.id)}
            isReadOnly={readOnly}
            description={permission.scoped ? t("roles.panel.scoped") : undefined}
            onChange={(selected) => {
              const permissions = new Set(draft.permissions);
              if (selected) permissions.add(permission.id);
              else permissions.delete(permission.id);
              onChange({ ...draft, permissions });
            }}
          >
            {t(label.key, { ns: label.ns })}
          </Checkbox>
        );
      })}
      {group.limits.map((limit) => {
        const label = limitLabelKey(limit.id);
        return (
          <TextInput
            key={limit.id}
            className="py-1"
            label={t(label.key, { ns: label.ns })}
            description={t("roles.panel.limitHelp", {
              kind: t(`roles.panel.limitKind.${limit.kind}`),
            })}
            errorMessage={limitErrors.has(limit.id) ? t("roles.problem.limitInvalid") : undefined}
            value={draft.limits[limit.id] ?? ""}
            onChange={(value) => {
              onChange({ ...draft, limits: { ...draft.limits, [limit.id]: value } });
            }}
            isReadOnly={readOnly}
            inputMode="decimal"
            dir="ltr"
            autoComplete="off"
          />
        );
      })}
    </div>
  );
}
