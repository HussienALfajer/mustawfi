import { ApiProblem, ApiUnreachable } from "@mustawfi/core-config/client";
import { tenancyProblemCodes } from "@mustawfi/core-tenancy/shared";
import {
  Badge,
  Button,
  Checkbox,
  CheckboxGroup,
  ConfirmDialog,
  enterMovesToNextField,
  Kbd,
  SegmentedControl,
  Select,
  SidePanel,
  TextArea,
  TextInput,
  useShortcut,
} from "@mustawfi/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  accessProblemCodes,
  type DepartmentScope,
  loginSchema,
  passwordSchema,
  pinSchema,
  type RoleView,
  type UserChangeRequest,
  userNameSchema,
  type UserView,
} from "../../shared/index.ts";
import { ACCESS_NAMESPACE } from "../messages.ts";
import {
  changeUser,
  clearUserTwoFactor,
  createUser,
  deactivateUser,
  reactivateUser,
  setUserPassword,
  setUserPin,
  usersQueryKey,
} from "./queries.ts";

/** A department as the users screen needs it; the list comes from `core.organization`. */
export interface DepartmentOption {
  readonly id: string;
  readonly name: string;
  readonly archivedAt: string | null;
}

/** The message key of a refusal, under `users.problem.`. */
export function userProblem(error: unknown): string {
  if (error instanceof ApiUnreachable) return "unreachable";
  if (!(error instanceof ApiProblem)) return "refused";
  switch (error.code) {
    case tenancyProblemCodes.userLimit:
      return "limit";
    case accessProblemCodes.loginTaken:
      return "loginTaken";
    case accessProblemCodes.loginRequired:
      return "loginRequired";
    case accessProblemCodes.unknownDepartment:
      return "unknownDepartment";
    case accessProblemCodes.roleArchived:
      return "roleArchived";
    case accessProblemCodes.roleNotFound:
      return "roleArchived";
    case accessProblemCodes.ownersOnly:
      return "ownersOnly";
    case accessProblemCodes.lastOwner:
      return "lastOwner";
    case accessProblemCodes.beyondOwnGrant:
      return "beyondOwnGrant";
    case accessProblemCodes.ownAccessChange:
      return "ownAccessChange";
    case accessProblemCodes.useOwnAccount:
      return "useOwnAccount";
    case accessProblemCodes.twoFactorNotEnabled:
      return "twoFactorNotEnabled";
    case accessProblemCodes.userNotFound:
      return "notFound";
    case accessProblemCodes.userDeactivated:
      return "alreadyDeactivated";
    case accessProblemCodes.userActive:
      return "alreadyActive";
    case accessProblemCodes.permissionDenied:
      return "permissionDenied";
    default:
      return "refused";
  }
}

interface UserDraft {
  readonly name: string;
  readonly login: string;
  readonly password: string;
  readonly roleId: string | null;
  readonly departmentScope: DepartmentScope;
  readonly departments: readonly string[];
  readonly pin: string;
}

type Field = "name" | "login" | "password" | "roleId" | "departments" | "pin";
type FieldErrors = Partial<Record<Field, string>>;

function draftOf(user: UserView | null): UserDraft {
  return {
    name: user?.name ?? "",
    login: user?.login ?? "",
    password: "",
    roleId: user?.role.id ?? null,
    departmentScope: user?.departmentScope ?? "all",
    departments: user?.departments ?? [],
    pin: "",
  };
}

/** Checks a draft with the server's own schemas; the keys are under `users.problem.`. */
export function checkUserDraft(
  draft: UserDraft,
  options: { readonly isNew: boolean; readonly ownerRole: boolean },
): FieldErrors {
  const errors: FieldErrors = {};
  const name = userNameSchema.safeParse(draft.name);
  if (!name.success) {
    errors.name = name.error.issues[0]?.code === "too_big" ? "nameTooLong" : "nameRequired";
  }
  const login = draft.login.trim();
  if (login !== "" && !loginSchema.safeParse(login).success) errors.login = "loginInvalid";
  if (options.isNew && draft.password !== "") {
    const password = passwordSchema.safeParse(draft.password);
    if (!password.success) {
      errors.password =
        password.error.issues[0]?.code === "too_big" ? "passwordTooLong" : "passwordTooShort";
    } else if (login === "") errors.login = "loginRequired";
  }
  if (draft.roleId === null) errors.roleId = "roleRequired";
  if (!options.ownerRole && draft.departmentScope === "listed" && draft.departments.length === 0) {
    errors.departments = "departmentsRequired";
  }
  if (options.isNew && !pinSchema.safeParse(draft.pin).success) errors.pin = "pinInvalid";
  return errors;
}

export interface UserPanelProps {
  /** The user shown, or `null` for a new one. */
  readonly user: UserView | null;
  readonly roles: readonly RoleView[];
  /** The store's departments, archived ones included. */
  readonly departments: readonly DepartmentOption[];
  /** Whether a department is asked for (more than one active department, rule 29). */
  readonly showDepartments: boolean;
  /** The signed-in user: their id, whether they are an owner, and `access.users.manage`. */
  readonly viewer: { readonly id: string; readonly isOwner: boolean; readonly canManage: boolean };
  readonly onClose: () => void;
  readonly onSaved: (user: UserView) => void;
}

/**
 * A user in the side panel: add one (name, optional login and password, role, departments,
 * first PIN), edit them, reset their PIN or password, deactivate them with a reason, or
 * reactivate them. Owners are managed by owners only; nobody changes their own role, scope,
 * PIN, or password here.
 */
export function UserPanel({
  user,
  roles,
  departments,
  showDepartments,
  viewer,
  onClose,
  onSaved,
}: UserPanelProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<UserDraft>(() => draftOf(user));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<string | undefined>();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);

  const isNew = user === null;
  const deactivated = user?.status === "deactivated";
  const isSelf = user?.id === viewer.id;
  // Owners are managed by owners only (rule 14); a deactivated user is reactivated first.
  const editable =
    viewer.canManage && !deactivated && (user?.role.isOwner !== true || viewer.isOwner);
  const accessEditable = editable && (!isSelf || viewer.isOwner);
  const role = roles.find((candidate) => candidate.id === draft.roleId);
  const ownerRole = role?.isOwner === true;
  const roleOptions = roles
    .filter(
      (candidate) =>
        candidate.id === user?.role.id ||
        (candidate.archivedAt === null && (!candidate.isOwner || viewer.isOwner)),
    )
    .map((candidate) => ({ id: candidate.id, label: candidate.name }));
  const activeDepartments = departments.filter((department) => department.archivedAt === null);

  const roleIsOwner = (roleId: string | null) =>
    roles.find((candidate) => candidate.id === roleId)?.isOwner === true;
  const change = (next: Partial<UserDraft>) => {
    const updated = { ...draft, ...next };
    setDraft(updated);
    // After a first check, each field is checked again as it changes.
    if (Object.keys(errors).length > 0) {
      setErrors(checkUserDraft(updated, { isNew, ownerRole: roleIsOwner(updated.roleId) }));
    }
  };

  const settle = async (saved: UserView, message: string) => {
    setNotice(t(message, { name: saved.name }));
    await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    onSaved(saved);
  };
  const save = useMutation({
    mutationFn: (values: UserDraft) => {
      const login = values.login.trim() === "" ? null : values.login.trim();
      const scope: DepartmentScope = roleIsOwner(values.roleId) ? "all" : values.departmentScope;
      const listed = scope === "listed" ? [...values.departments] : [];
      if (user === null) {
        return createUser({
          name: values.name,
          login,
          password: values.password === "" ? null : values.password,
          roleId: values.roleId ?? "",
          departmentScope: scope,
          departments: listed,
          pin: values.pin,
        });
      }
      const request: UserChangeRequest = {
        ...(values.name.trim() === user.name ? {} : { name: values.name }),
        ...(login === user.login ? {} : { login }),
        ...(values.roleId === user.role.id || values.roleId === null
          ? {}
          : { roleId: values.roleId }),
        ...(scope === user.departmentScope &&
        [...listed].sort().join() === [...user.departments].sort().join()
          ? {}
          : { departmentScope: scope, departments: listed }),
      };
      return changeUser(user.id, request);
    },
    onSuccess: async (saved) => {
      setDraft(draftOf(saved));
      await settle(saved, isNew ? "users.panel.added" : "users.panel.saved");
      // The first PIN and password fields leave with the new user; focus stays in the panel.
      if (isNew) nameRef.current?.focus();
    },
    onError: (error) => {
      const problem = userProblem(error);
      if (problem === "loginTaken" || problem === "loginRequired") {
        setErrors({ login: problem });
      }
    },
  });
  const deactivate = useMutation({
    mutationFn: ({ id, why }: { id: string; why: string }) => deactivateUser(id, why),
    onSuccess: async (saved) => {
      setConfirming(false);
      setReason("");
      setDraft(draftOf(saved));
      await settle(saved, "users.deactivate.done");
      // The button that opened the dialog is gone; focus stays in the panel.
      nameRef.current?.focus();
    },
    onError: () => {
      setConfirming(false);
    },
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: async (saved) => {
      setDraft(draftOf(saved));
      await settle(saved, "users.panel.reactivated");
      nameRef.current?.focus();
    },
  });
  const resetMutations = () => {
    setNotice(undefined);
    save.reset();
    deactivate.reset();
    reactivate.reset();
  };

  const submit = () => {
    resetMutations();
    const found = checkUserDraft(draft, { isNew, ownerRole });
    setErrors(found);
    const [first] = Object.keys(found);
    if (first === undefined) {
      save.mutate(draft);
      return;
    }
    formRef.current
      ?.querySelector<HTMLElement>(`[data-field="${first}"] input, [data-field="${first}"] button`)
      ?.focus();
  };
  useShortcut({ key: "s", ctrl: true }, () => {
    if (editable) submit();
  });

  const failure = [save.error, deactivate.error, reactivate.error]
    .filter((error) => error !== null)
    .map((error) => userProblem(error))
    .find((problem) => problem !== "loginTaken" && problem !== "loginRequired");
  const fieldError = (field: Field) => {
    const key = errors[field];
    return key === undefined ? undefined : t(`users.problem.${key}`);
  };

  return (
    <SidePanel
      title={user?.name ?? t("users.panel.newTitle")}
      closeLabel={t("users.panel.close")}
      onClose={onClose}
      footer={
        !viewer.canManage || (user?.role.isOwner === true && !viewer.isOwner) ? undefined : (
          <>
            {deactivated ? null : (
              <Button aria-keyshortcuts="Control+S" isPending={save.isPending} onPress={submit}>
                {t(isNew ? "users.panel.add" : "users.panel.save")}
                <Kbd shortcut="Control+S" />
              </Button>
            )}
            {user === null ? null : deactivated ? (
              <Button
                variant="secondary"
                isPending={reactivate.isPending}
                onPress={() => {
                  resetMutations();
                  reactivate.mutate(user.id);
                }}
              >
                {t("users.panel.reactivate")}
              </Button>
            ) : isSelf ? null : (
              <Button
                variant="danger"
                className="ms-auto"
                onPress={() => {
                  setReasonError(false);
                  setConfirming(true);
                }}
              >
                {t("users.panel.deactivate")}
              </Button>
            )}
          </>
        )
      }
    >
      <form
        ref={formRef}
        noValidate
        onKeyDown={enterMovesToNextField}
        onSubmit={(event) => {
          event.preventDefault();
          if (editable) submit();
        }}
        className="flex flex-col gap-4"
      >
        {user === null ? null : (
          <div className="flex flex-wrap gap-2">
            {deactivated ? (
              <Badge tone="neutral">{t("users.state.deactivated")}</Badge>
            ) : (
              <Badge tone="positive">{t("users.state.active")}</Badge>
            )}
            <Badge tone="neutral">
              {t(user.hasPin ? "users.panel.hasPin" : "users.panel.noPin")}
            </Badge>
            <Badge tone="neutral">
              {t(user.hasPassword ? "users.panel.hasPassword" : "users.panel.noPassword")}
            </Badge>
          </div>
        )}
        <div data-field="name">
          <TextInput
            label={`${t("users.panel.name")} ${t("users.panel.required")}`}
            errorMessage={fieldError("name")}
            value={draft.name}
            onChange={(name) => {
              change({ name });
            }}
            inputRef={nameRef}
            isReadOnly={!editable}
            autoFocus={isNew}
            autoComplete="off"
          />
        </div>
        <div data-field="login">
          <TextInput
            label={`${t("users.panel.login")} ${t("users.panel.optional")}`}
            description={t("users.panel.loginHelp")}
            errorMessage={fieldError("login")}
            value={draft.login}
            onChange={(login) => {
              change({ login });
            }}
            isReadOnly={!editable}
            dir="ltr"
            autoComplete="off"
          />
        </div>
        {isNew ? (
          <div data-field="password">
            <TextInput
              label={`${t("users.panel.password")} ${t("users.panel.optional")}`}
              description={t("users.panel.passwordHelp")}
              errorMessage={fieldError("password")}
              type="password"
              value={draft.password}
              onChange={(password) => {
                change({ password });
              }}
              dir="ltr"
              autoComplete="new-password"
            />
          </div>
        ) : null}
        <div data-field="roleId">
          <Select
            label={`${t("users.panel.role")} ${t("users.panel.required")}`}
            placeholder={t("users.panel.choose")}
            options={roleOptions}
            value={draft.roleId}
            onChange={(roleId) => {
              change({ roleId });
            }}
            errorMessage={fieldError("roleId")}
            isDisabled={!accessEditable}
          />
        </div>
        {showDepartments && !ownerRole ? (
          <ScopeFields
            draft={draft}
            departments={activeDepartments}
            readOnly={!accessEditable}
            errorMessage={fieldError("departments")}
            onChange={change}
          />
        ) : null}
        {isNew ? (
          <div data-field="pin">
            <TextInput
              label={`${t("users.panel.pin")} ${t("users.panel.required")}`}
              description={t("users.panel.pinHelp")}
              errorMessage={fieldError("pin")}
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={draft.pin}
              onChange={(pin) => {
                change({ pin });
              }}
              dir="ltr"
              autoComplete="off"
            />
          </div>
        ) : null}
        {user?.role.isOwner === true ? <Note>{t("users.panel.ownerNote")}</Note> : null}
        {deactivated ? <Note>{t("users.panel.deactivatedNote")}</Note> : null}
        {!viewer.canManage ? <Note>{t("users.panel.readOnlyNote")}</Note> : null}
        {failure === undefined ? null : (
          <p role="alert" className="text-text-negative">
            {t(`users.problem.${failure}`)}
          </p>
        )}
        <p role="status" className="min-h-5 text-text-positive">
          {notice}
        </p>
      </form>
      {user !== null && editable && !isSelf ? (
        <SecretsSection user={user} viewerIsOwner={viewer.isOwner} onSaved={settle} />
      ) : null}
      {user === null ? null : (
        <ConfirmDialog
          isOpen={confirming}
          onOpenChange={setConfirming}
          title={t("users.deactivate.title", { name: user.name })}
          confirmLabel={t("users.deactivate.confirm")}
          cancelLabel={t("users.deactivate.cancel")}
          isPending={deactivate.isPending}
          onConfirm={() => {
            const why = reason.trim();
            if (why === "") {
              setReasonError(true);
              return;
            }
            resetMutations();
            deactivate.mutate({ id: user.id, why });
          }}
        >
          <div className="flex flex-col gap-3">
            <p>{t("users.deactivate.body")}</p>
            <TextArea
              label={t("users.deactivate.reason")}
              description={t("users.deactivate.reasonHelp")}
              errorMessage={reasonError ? t("users.problem.reasonRequired") : undefined}
              value={reason}
              onChange={(value) => {
                setReason(value);
                if (value.trim() !== "") setReasonError(false);
              }}
              maxLength={500}
              rows={2}
            />
          </div>
        </ConfirmDialog>
      )}
    </SidePanel>
  );
}

function Note({ children }: { readonly children: string }) {
  return <p className="rounded-sm bg-sunken px-3 py-2 text-sm text-text-secondary">{children}</p>;
}

function ScopeFields({
  draft,
  departments,
  readOnly,
  errorMessage,
  onChange,
}: {
  readonly draft: UserDraft;
  readonly departments: readonly DepartmentOption[];
  readonly readOnly: boolean;
  readonly errorMessage: string | undefined;
  readonly onChange: (next: Partial<UserDraft>) => void;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <div className="flex flex-col gap-2" data-field="departments">
      <span aria-hidden="true" className="text-sm font-medium text-text">
        {t("users.panel.scope")}
      </span>
      <div className="self-start">
        <SegmentedControl
          label={t("users.panel.scope")}
          value={draft.departmentScope}
          onChange={(departmentScope) => {
            if (!readOnly) onChange({ departmentScope });
          }}
          options={[
            { id: "all", label: t("users.panel.scopeAll") },
            { id: "listed", label: t("users.panel.scopeListed") },
          ]}
        />
      </div>
      {draft.departmentScope === "listed" ? (
        <CheckboxGroup
          label={t("users.panel.departments")}
          description={t("users.panel.departmentsHelp")}
          errorMessage={errorMessage}
          value={draft.departments}
          onChange={(value) => {
            onChange({ departments: value });
          }}
          isReadOnly={readOnly}
        >
          {departments.map((department) => (
            <Checkbox key={department.id} value={department.id}>
              {department.name}
            </Checkbox>
          ))}
        </CheckboxGroup>
      ) : null}
    </div>
  );
}

/**
 * A manager resets someone's PIN or password; each is saved on its own. An owner also clears
 * someone's two-factor authentication (`core-foundation` rule 26), confirmed once with a reason.
 */
function SecretsSection({
  user,
  viewerIsOwner,
  onSaved,
}: {
  readonly user: UserView;
  readonly viewerIsOwner: boolean;
  readonly onSaved: (user: UserView, message: string) => Promise<void>;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const headingId = useId();
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [pinError, setPinError] = useState<string | undefined>();
  const [passwordError, setPasswordError] = useState<string | undefined>();
  const pinMutation = useMutation({
    mutationFn: (value: string) => setUserPin(user.id, value),
    onSuccess: async (saved) => {
      setPin("");
      await onSaved(saved, "users.panel.pinSet");
    },
    onError: (error) => {
      setPinError(t(`users.problem.${userProblem(error)}`));
    },
  });
  const passwordMutation = useMutation({
    mutationFn: (value: string) => setUserPassword(user.id, value),
    onSuccess: async (saved) => {
      setPassword("");
      await onSaved(saved, "users.panel.passwordSet");
    },
    onError: (error) => {
      setPasswordError(t(`users.problem.${userProblem(error)}`));
    },
  });
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-divider pt-3"
    >
      <h3 id={headingId} className="text-base font-semibold">
        {t("users.panel.secrets")}
      </h3>
      <form
        noValidate
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pinSchema.safeParse(pin).success) {
            setPinError(t("users.problem.pinInvalid"));
            return;
          }
          setPinError(undefined);
          pinMutation.mutate(pin);
        }}
      >
        <TextInput
          className="flex-1"
          label={t("users.panel.newPin")}
          errorMessage={pinError}
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={setPin}
          dir="ltr"
          autoComplete="off"
        />
        <Button type="submit" variant="secondary" isPending={pinMutation.isPending}>
          {t("users.panel.setPin")}
        </Button>
      </form>
      <form
        noValidate
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = passwordSchema.safeParse(password);
          if (!parsed.success) {
            setPasswordError(
              t(
                parsed.error.issues[0]?.code === "too_big"
                  ? "users.problem.passwordTooLong"
                  : "users.problem.passwordTooShort",
              ),
            );
            return;
          }
          setPasswordError(undefined);
          passwordMutation.mutate(password);
        }}
      >
        <TextInput
          className="flex-1"
          label={t("users.panel.newPassword")}
          errorMessage={passwordError}
          type="password"
          value={password}
          onChange={setPassword}
          dir="ltr"
          autoComplete="new-password"
        />
        <Button type="submit" variant="secondary" isPending={passwordMutation.isPending}>
          {t("users.panel.setPassword")}
        </Button>
      </form>
      <TwoFactorRow user={user} canClear={viewerIsOwner} onSaved={onSaved} />
    </section>
  );
}

/** Whether the user has two-factor authentication, and an owner's way to clear it. */
function TwoFactorRow({
  user,
  canClear,
  onSaved,
}: {
  readonly user: UserView;
  readonly canClear: boolean;
  readonly onSaved: (user: UserView, message: string) => Promise<void>;
}) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState(false);
  const clear = useMutation({
    mutationFn: (why: string) => clearUserTwoFactor(user.id, why),
    onSuccess: async (saved) => {
      setConfirming(false);
      setReason("");
      await onSaved(saved, "users.panel.twoFactorCleared");
    },
  });
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={user.twoFactorEnabled ? "positive" : "neutral"}>
          {t(user.twoFactorEnabled ? "users.panel.twoFactorOn" : "users.panel.twoFactorOff")}
        </Badge>
        {canClear && user.twoFactorEnabled ? (
          <Button
            variant="secondary"
            onPress={() => {
              clear.reset();
              setConfirming(true);
            }}
          >
            {t("users.panel.clearTwoFactor")}
          </Button>
        ) : null}
      </div>
      {clear.error === null ? null : (
        <p role="alert" className="text-text-negative">
          {t(`users.problem.${userProblem(clear.error)}`)}
        </p>
      )}
      <ConfirmDialog
        isOpen={confirming}
        onOpenChange={setConfirming}
        title={t("users.clearTwoFactor.title", { name: user.name })}
        confirmLabel={t("users.clearTwoFactor.confirm")}
        cancelLabel={t("users.clearTwoFactor.cancel")}
        isPending={clear.isPending}
        onConfirm={() => {
          const why = reason.trim();
          if (why === "") {
            setReasonError(true);
            return;
          }
          clear.mutate(why);
        }}
      >
        <div className="flex flex-col gap-3">
          <p>{t("users.clearTwoFactor.body")}</p>
          <TextArea
            label={t("users.clearTwoFactor.reason")}
            description={t("users.clearTwoFactor.reasonHelp")}
            errorMessage={reasonError ? t("users.problem.clearReasonRequired") : undefined}
            value={reason}
            onChange={(value) => {
              setReason(value);
              if (value.trim() !== "") setReasonError(false);
            }}
            maxLength={500}
            rows={2}
          />
        </div>
      </ConfirmDialog>
    </div>
  );
}
