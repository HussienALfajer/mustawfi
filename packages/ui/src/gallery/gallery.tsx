import { Currency, Money as KernelMoney } from "@mustawfi/kernel";
import { Layers, ShoppingCart, ReceiptText } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "../components/badge.tsx";
import { Button, buttonClass, type ButtonVariant } from "../components/button.tsx";
import { Checkbox, CheckboxGroup } from "../components/checkbox.tsx";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { CopyButton } from "../components/copy-button.tsx";
import { SupportContact } from "../components/support-contact.tsx";
import { cx } from "../components/cx.ts";
import { DatePicker, DateRangePicker, type DateRangeValue } from "../components/date-picker.tsx";
import { DataTable } from "../components/data-table.tsx";
import { ModalDialog } from "../components/dialog.tsx";
import {
  ITEM_STATES,
  LINK_ITEM_STATES,
  ROW_STATES,
  SEGMENT_STATES,
  TEXT_LINK,
} from "../components/interaction.ts";
import { Kbd } from "../components/kbd.tsx";
import { MenuButton } from "../components/menu-button.tsx";
import { MoneyInput } from "../components/money-input.tsx";
import { Money } from "../components/money.tsx";
import { PasswordField } from "../components/password-field.tsx";
import { EMPTY_PHONE, PhoneField, type PhoneValue } from "../components/phone-field.tsx";
import { SearchField } from "../components/search-field.tsx";
import { SegmentedControl } from "../components/segmented-control.tsx";
import { Select } from "../components/select.tsx";
import { FormFooter, FormSection } from "../components/settings-form.tsx";
import { NAV_LINK_CLASS, SideNavigation } from "../components/side-navigation.tsx";
import { SidePanel } from "../components/side-panel.tsx";
import { TextArea } from "../components/text-area.tsx";
import { TextInput } from "../components/text-input.tsx";
import { Toast, ToastProvider, useToast } from "../components/toast.tsx";
import { checkContrast } from "../tokens/contrast.ts";
import { generatePalette, RAMP_SPECS, STEPS } from "../tokens/palette.ts";
import { type DensityName, TYPE_SCALE } from "../tokens/scale.ts";
import {
  primitiveName,
  resolveTheme,
  SEMANTIC_TOKENS,
  THEMES,
  type ThemeName,
} from "../tokens/themes.ts";
import { GALLERY_NAMESPACE } from "./messages.ts";

const palette = generatePalette();
const THEME_NAMES: readonly ThemeName[] = ["light", "dark"];
const DENSITY_NAMES: readonly DensityName[] = ["compact", "comfortable", "touch"];
const SYP = Currency.of("SYP", 2);
const USD = Currency.of("USD", 2);

/**
 * Every exported component of `packages/ui`, by name. The gallery test fails when the package
 * exports a component that is not listed here, so nothing ships without a specimen.
 */
export const GALLERY_COMPONENTS = [
  "Badge",
  "Button",
  "Checkbox",
  "CheckboxGroup",
  "ConfirmDialog",
  "CopyButton",
  "DataTable",
  "DatePicker",
  "DateRangePicker",
  "FormFooter",
  "FormSection",
  "Kbd",
  "MenuButton",
  "ModalDialog",
  "Money",
  "MoneyInput",
  "PasswordField",
  "PhoneField",
  "SearchField",
  "SegmentedControl",
  "Select",
  "SideNavigation",
  "SidePanel",
  "SupportContact",
  "TextArea",
  "TextInput",
  "Toast",
  "ToastProvider",
] as const;

type GalleryComponent = (typeof GALLERY_COMPONENTS)[number];

function Specimen({
  name,
  children,
}: {
  readonly name: GalleryComponent;
  readonly children: ReactNode;
}) {
  return (
    <div data-component={name} className="flex flex-col gap-2">
      <code dir="ltr" className="self-start font-mono text-xs text-text-secondary">
        {name}
      </code>
      <div className="flex flex-wrap items-start gap-density-gap">{children}</div>
    </div>
  );
}

interface DepartmentRow {
  readonly id: string;
  readonly name: string;
  readonly users: number;
  readonly active: boolean;
}

/** Every component once, in the theme and density of the surrounding block. */
function Specimens() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  const [name, setName] = useState(t("sample.storeNameValue"));
  const [address, setAddress] = useState(t("sample.addressValue"));
  const [amount, setAmount] = useState("1250.50");
  const [currency, setCurrency] = useState(USD);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "all">("active");
  const [selected, setSelected] = useState<string | null>("repairs");
  const [collapsed, setCollapsed] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [role, setRole] = useState<"cashier" | "accountant" | null>("cashier");
  const [allowed, setAllowed] = useState(true);
  const [scope, setScope] = useState<string[]>(["repairs"]);
  const [password, setPassword] = useState("s3cret-Pass");
  const [phone, setPhone] = useState<PhoneValue>({ country: "SY", number: "0944 123 456" });
  const [otherPhone, setOtherPhone] = useState<PhoneValue>(EMPTY_PHONE);
  const [pin, setPin] = useState("4827");
  const [date, setDate] = useState<string | null>("2026-09-27");
  const [range, setRange] = useState<DateRangeValue | null>({
    start: "2026-09-01",
    end: "2026-09-27",
  });
  const toast = useToast();
  const rows: DepartmentRow[] = [
    { id: "store", name: t("sample.rows.store"), users: 2, active: true },
    { id: "repairs", name: t("sample.rows.repairs"), users: 3, active: true },
    { id: "accessories", name: t("sample.rows.accessories"), users: 0, active: false },
  ];
  const link =
    (current: boolean) =>
    ({ className, children }: { readonly className: string; readonly children: ReactNode }) => (
      <a
        href="#components"
        className={className}
        {...(current ? { "aria-current": "page" as const } : {})}
      >
        {children}
      </a>
    );
  return (
    <div className="flex flex-col gap-6">
      <Specimen name="Button">
        <Button>{t("sample.save")}</Button>
        <Button variant="secondary">{t("sample.cancel")}</Button>
        <Button variant="quiet">{t("sample.more")}</Button>
        <Button variant="danger">{t("sample.archive")}</Button>
        <Button isPending>{t("sample.saving")}</Button>
      </Specimen>
      <Specimen name="MenuButton">
        <MenuButton
          actions={[
            { id: "account", label: t("sample.account") },
            { id: "signOut", label: t("sample.signOut") },
          ]}
          onAction={() => undefined}
        >
          <span className="flex flex-col text-sm leading-tight">
            <span>{t("sample.userName")}</span>
            <span className="text-xs text-text-secondary">{t("sample.userRole")}</span>
          </span>
        </MenuButton>
      </Specimen>
      <Specimen name="Kbd">
        <Button aria-keyshortcuts="Control+S">
          {t("sample.save")} <Kbd shortcut="Control+S" />
        </Button>
        <Kbd shortcut="Escape" />
        <Kbd shortcut="/" />
      </Specimen>
      <Specimen name="Badge">
        <Badge tone="positive">{t("sample.active")}</Badge>
        <Badge tone="neutral">{t("sample.deactivated")}</Badge>
        <Badge tone="info">{t("sample.default")}</Badge>
        <Badge tone="warning">{t("sample.expiring")}</Badge>
        <Badge tone="negative">{t("sample.revoked")}</Badge>
        <Badge tone="archived">{t("sample.archived")}</Badge>
      </Specimen>
      <Specimen name="TextInput">
        <TextInput
          label={t("sample.storeName")}
          description={t("sample.help")}
          value={name}
          onChange={setName}
        />
        <TextInput label={t("sample.storeName")} errorMessage={t("sample.required")} value="" />
        <TextInput label={t("sample.documentNumber")} dir="ltr" value="K7-INV-000123" isReadOnly />
      </Specimen>
      <Specimen name="PasswordField">
        <PasswordField
          label={t("sample.password")}
          autoComplete="off"
          value={password}
          onChange={setPassword}
        />
        <PasswordField
          label={t("sample.pin")}
          description={t("sample.pinHelp")}
          inputMode="numeric"
          maxLength={6}
          autoComplete="off"
          value={pin}
          onChange={setPin}
        />
        <PasswordField
          label={t("sample.resetCode")}
          errorMessage={t("sample.required")}
          autoComplete="off"
          value=""
        />
      </Specimen>
      <Specimen name="PhoneField">
        <PhoneField
          label={t("sample.phone")}
          countryLabel={t("sample.countryCode")}
          description={t("sample.phoneHelp")}
          value={phone}
          onChange={setPhone}
          className="flex w-96 items-start gap-2"
        />
        <PhoneField
          label={t("sample.phone")}
          countryLabel={t("sample.countryCode")}
          errorMessage={t("sample.phoneInvalid")}
          value={otherPhone}
          onChange={setOtherPhone}
          className="flex w-96 items-start gap-2"
        />
      </Specimen>
      <Specimen name="CopyButton">
        <span className="inline-flex items-center gap-2">
          <bdi dir="ltr" className="font-mono text-lg">
            {t("sample.registrationCodeValue")}
          </bdi>
          <CopyButton
            value={t("sample.registrationCodeValue")}
            label={t("sample.registrationCode")}
          />
        </span>
      </Specimen>
      <Specimen name="SupportContact">
        <SupportContact whatsapp="+963945739573" />
      </Specimen>
      <Specimen name="DatePicker">
        <DatePicker label={t("sample.date")} value={date} onChange={setDate} />
      </Specimen>
      <Specimen name="DateRangePicker">
        <DateRangePicker label={t("sample.dateRange")} value={range} onChange={setRange} />
        <DateRangePicker
          label={t("sample.dateRange")}
          value={null}
          onChange={() => undefined}
          errorMessage={t("sample.dateRangeError")}
        />
      </Specimen>
      <Specimen name="Toast">
        <div className="flex w-full max-w-sm flex-col gap-2">
          <Toast tone="success" message={t("sample.toastSaved")} onClose={() => undefined} />
          <Toast tone="info" message={t("sample.toastInfo")} onClose={() => undefined} />
          <Toast tone="warning" message={t("sample.toastWarning")} onClose={() => undefined} />
        </div>
      </Specimen>
      <Specimen name="ToastProvider">
        <Button
          variant="secondary"
          onPress={() => {
            toast.show(t("sample.toastSaved"));
          }}
        >
          {t("sample.toastShow")}
        </Button>
      </Specimen>
      <Specimen name="TextArea">
        <TextArea label={t("sample.address")} value={address} onChange={setAddress} rows={2} />
      </Specimen>
      <Specimen name="Select">
        <Select
          label={t("sample.role")}
          value={role}
          onChange={setRole}
          options={[
            { id: "cashier", label: t("sample.roleCashier") },
            { id: "accountant", label: t("sample.roleAccountant") },
          ]}
        />
        <Select
          label={t("sample.role")}
          placeholder={t("sample.choose")}
          errorMessage={t("sample.required")}
          value={null}
          onChange={() => undefined}
          options={[{ id: "cashier", label: t("sample.roleCashier") }]}
        />
      </Specimen>
      <Specimen name="Checkbox">
        <Checkbox
          isSelected={allowed}
          onChange={setAllowed}
          description={t("sample.permissionHelp")}
        >
          {t("sample.permission")}
        </Checkbox>
        <Checkbox isSelected={false} isReadOnly>
          {t("sample.permissionOff")}
        </Checkbox>
      </Specimen>
      <Specimen name="CheckboxGroup">
        <CheckboxGroup label={t("sample.scope")} value={scope} onChange={setScope}>
          {rows.map((row) => (
            <Checkbox key={row.id} value={row.id}>
              {row.name}
            </Checkbox>
          ))}
        </CheckboxGroup>
      </Specimen>
      <Specimen name="MoneyInput">
        <MoneyInput
          label={t("sample.price")}
          amount={amount}
          onAmountChange={setAmount}
          currency={currency}
          currencies={[SYP, USD]}
          onCurrencyChange={setCurrency}
        />
      </Specimen>
      <Specimen name="Money">
        <Money value={KernelMoney.of("1250.5", USD)} />
        <Money value={KernelMoney.of("-4200000", SYP)} />
        <span className="inline-flex gap-2 border-b-4 border-double border-total-rule font-semibold">
          {t("sample.total")} <Money value={KernelMoney.of("98765.43", SYP)} />
        </span>
      </Specimen>
      <Specimen name="SearchField">
        <SearchField
          label={t("sample.search")}
          value={search}
          onChange={setSearch}
          slashShortcut={false}
        />
      </Specimen>
      <Specimen name="SegmentedControl">
        <SegmentedControl
          label={t("sample.status")}
          value={status}
          onChange={setStatus}
          options={[
            { id: "active", label: t("sample.active") },
            { id: "archived", label: t("sample.archived") },
            { id: "all", label: t("sample.statusAll") },
          ]}
        />
      </Specimen>
      <Specimen name="DataTable">
        <div className="flex w-full min-w-0 border border-divider">
          <div className="min-w-0 flex-1">
            <DataTable
              label={t("sample.table")}
              rows={rows}
              rowId={(row) => row.id}
              selectedId={selected}
              onSelect={setSelected}
              columns={[
                { id: "name", header: t("sample.name"), cell: (row) => row.name },
                {
                  id: "status",
                  header: t("sample.status"),
                  cell: (row) =>
                    row.active ? (
                      <Badge tone="positive">{t("sample.active")}</Badge>
                    ) : (
                      <Badge tone="archived">{t("sample.archived")}</Badge>
                    ),
                },
                {
                  id: "users",
                  header: t("sample.users"),
                  align: "end",
                  cell: (row) => row.users,
                },
              ]}
            />
          </div>
          <div data-component="SidePanel" className="flex">
            {selected === null ? null : (
              <SidePanel
                title={t("sample.panelTitle")}
                closeLabel={t("sample.close")}
                onClose={() => {
                  setSelected(null);
                }}
                className="w-72"
                footer={<Button>{t("sample.save")}</Button>}
              >
                <p className="text-text-secondary">{t("sample.panelBody")}</p>
              </SidePanel>
            )}
          </div>
        </div>
      </Specimen>
      <Specimen name="FormSection">
        <div data-component="FormFooter" className="flex w-full max-w-xl flex-col">
          <FormSection
            title={t("sample.sectionTitle")}
            description={t("sample.sectionDescription")}
          >
            <TextInput label={t("sample.storeName")} value={name} onChange={setName} />
          </FormSection>
          <FormFooter>
            <Button>{t("sample.save")}</Button>
            <Button variant="secondary">{t("sample.cancel")}</Button>
          </FormFooter>
        </div>
      </Specimen>
      <Specimen name="SideNavigation">
        <div className="flex h-64">
          <SideNavigation
            label={t("sample.navigation")}
            brand={<span className="text-xl font-bold">{t("title")}</span>}
            collapsedBrand={<span className="text-xl font-bold">م</span>}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            collapseLabel={t("sample.collapse")}
            expandLabel={t("sample.expand")}
            groups={[
              {
                id: "sales",
                label: t("sample.navSales"),
                items: [
                  {
                    id: "pos",
                    label: t("sample.navPos"),
                    icon: <ShoppingCart size={20} strokeWidth={1.75} />,
                    link: link(false),
                  },
                  {
                    id: "invoices",
                    label: t("sample.navInvoices"),
                    icon: <ReceiptText size={20} strokeWidth={1.75} />,
                    link: link(false),
                  },
                ],
              },
              {
                id: "admin",
                label: t("sample.navAdmin"),
                items: [
                  {
                    id: "departments",
                    label: t("sample.navDepartments"),
                    icon: <Layers size={20} strokeWidth={1.75} />,
                    link: link(true),
                  },
                ],
              },
            ]}
          />
        </div>
        <a href="#components" className={NAV_LINK_CLASS}>
          {t("sample.navDepartments")}
        </a>
      </Specimen>
      <Specimen name="ConfirmDialog">
        <Button
          variant="danger"
          onPress={() => {
            setConfirming(true);
          }}
        >
          {t("sample.confirmOpen")}
        </Button>
        <ConfirmDialog
          isOpen={confirming}
          onOpenChange={setConfirming}
          title={t("sample.confirmTitle")}
          confirmLabel={t("sample.archive")}
          cancelLabel={t("sample.cancel")}
          onConfirm={() => {
            setConfirming(false);
          }}
        >
          {t("sample.confirmBody")}
        </ConfirmDialog>
      </Specimen>
      <Specimen name="ModalDialog">
        <Button
          variant="secondary"
          onPress={() => {
            setDialogOpen(true);
          }}
        >
          {t("sample.dialogOpen")}
        </Button>
        <ModalDialog
          isOpen={dialogOpen}
          onOpenChange={setDialogOpen}
          title={t("sample.dialogTitle")}
          density="touch"
        >
          <p className="text-text-secondary">{t("sample.dialogBody")}</p>
          <div>
            <Button
              variant="quiet"
              onPress={() => {
                setDialogOpen(false);
              }}
            >
              {t("sample.cancel")}
            </Button>
          </div>
        </ModalDialog>
      </Specimen>
    </div>
  );
}

type ForcedState = "rest" | "hover" | "pressed" | "selected" | "focus";

const FORCED_STATES: readonly ForcedState[] = ["rest", "hover", "pressed", "selected", "focus"];

/** The attributes React Aria sets for a state, set by hand so every state shows at once. */
function forced(state: ForcedState): Record<string, string | undefined> {
  switch (state) {
    case "rest":
      return {};
    case "hover":
      return { "data-hovered": "true" };
    case "pressed":
      return { "data-hovered": "true", "data-pressed": "true" };
    case "selected":
      return { "data-selected": "true" };
    case "focus":
      return { "data-focus-visible": "true", "data-focused": "true" };
  }
}

interface StateKind {
  readonly id: string;
  /** Whether the kind has a selected state (a button has none). */
  readonly selectable: boolean;
  readonly render: (state: ForcedState, label: string) => ReactNode;
}

const buttonKind = (variant: ButtonVariant): StateKind => ({
  id: variant,
  selectable: false,
  render: (state, label) => (
    <span {...forced(state)} className={buttonClass(variant)}>
      {label}
    </span>
  ),
});

const STATE_KINDS: readonly StateKind[] = [
  buttonKind("primary"),
  buttonKind("secondary"),
  buttonKind("quiet"),
  buttonKind("danger"),
  {
    id: "row",
    selectable: true,
    render: (state, label) => (
      <span
        {...forced(state)}
        className={cx("flex h-row w-32 items-center bg-surface px-pad-inline", ROW_STATES)}
      >
        {label}
      </span>
    ),
  },
  {
    id: "nav",
    selectable: true,
    render: (state, label) => (
      <span
        {...forced(state)}
        {...(state === "selected" ? { "aria-current": "page" as const } : {})}
        className={cx(
          "flex h-9 w-32 items-center rounded-md px-3 text-text-secondary",
          LINK_ITEM_STATES,
        )}
      >
        {label}
      </span>
    ),
  },
  {
    id: "menu",
    selectable: true,
    render: (state, label) => (
      <span
        {...forced(state)}
        className={cx("flex w-32 rounded-sm px-pad-inline py-1.5", ITEM_STATES)}
      >
        {label}
      </span>
    ),
  },
  {
    id: "segment",
    selectable: true,
    render: (state, label) => (
      <span
        {...forced(state)}
        className={cx(
          "inline-flex h-[26px] items-center border border-field-border bg-surface px-2.5 text-sm",
          SEGMENT_STATES,
        )}
      >
        {label}
      </span>
    ),
  },
  {
    id: "link",
    selectable: false,
    render: (state, label) => (
      <span
        {...(state === "hover" ? { style: { textDecorationThickness: "2px" } } : {})}
        {...(state === "focus"
          ? { style: { outline: "2px solid var(--mf-color-focus-ring)", outlineOffset: "2px" } }
          : {})}
        {...(state === "pressed" ? { style: { color: "var(--mf-color-text)" } } : {})}
        className={TEXT_LINK}
      >
        {label}
      </span>
    ),
  },
];

/**
 * Every clickable kind in every state at once (core-foundation slice 19): the preview the user
 * approves, and the check that the interaction tokens hold in each theme and density.
 */
function StatesTable() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  return (
    <div data-states className="flex flex-col gap-2">
      <h4 className="font-semibold">{t("states.title")}</h4>
      <p className="max-w-3xl text-sm text-text-secondary">{t("states.intro")}</p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-2 text-start">
          <thead>
            <tr className="text-xs text-text-secondary">
              <th className="text-start font-medium">{t("states.kind")}</th>
              {FORCED_STATES.map((state) => (
                <th key={state} className="text-start font-medium">
                  {t(`states.${state}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {STATE_KINDS.map((kind) => (
              <tr key={kind.id}>
                <th scope="row" className="text-start text-xs font-medium text-text-secondary">
                  {t(`states.${kind.id}`)}
                </th>
                {FORCED_STATES.map((state) => (
                  <td key={state} aria-hidden="true">
                    {state === "selected" && !kind.selectable ? (
                      <span className="text-text-secondary">{t("states.notApplicable")}</span>
                    ) : (
                      kind.render(state, t(`states.${kind.id}`))
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PaletteSection() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  return (
    <section id="palette" aria-labelledby="palette-title" className="flex flex-col gap-3">
      <h2 id="palette-title" className="text-xl font-semibold">
        {t("sections.palette")}
      </h2>
      {RAMP_SPECS.map((spec) => (
        <div key={spec.name} className="flex flex-col gap-1">
          <code dir="ltr" className="self-start font-mono text-xs text-text-secondary">
            {spec.name}
          </code>
          <div className="grid grid-cols-11 overflow-hidden rounded-sm border border-divider">
            {STEPS.map((step) => (
              <div
                key={step}
                aria-hidden="true"
                title={`${spec.name}-${String(step)} ${palette[spec.name][step]}`}
                className="h-8"
                style={{ backgroundColor: palette[spec.name][step] }}
              />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function SemanticSection() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  const resolved = {
    light: resolveTheme(palette, THEMES.light),
    dark: resolveTheme(palette, THEMES.dark),
  };
  return (
    <section id="semantic" aria-labelledby="semantic-title" className="flex flex-col gap-3">
      <h2 id="semantic-title" className="text-xl font-semibold">
        {t("sections.semantic")}
      </h2>
      <table className="w-full border-collapse bg-surface text-sm">
        <thead>
          <tr className="border-b border-field-border text-start text-text-secondary">
            <th className="px-2 py-1 text-start font-semibold">{t("semantic.token")}</th>
            <th className="px-2 py-1 text-start font-semibold">{t("semantic.light")}</th>
            <th className="px-2 py-1 text-start font-semibold">{t("semantic.dark")}</th>
          </tr>
        </thead>
        <tbody>
          {SEMANTIC_TOKENS.map((token) => (
            <tr key={token} className="border-b border-divider">
              <th scope="row" className="px-2 py-1 text-start font-normal">
                <code dir="ltr" className="font-mono text-xs">{`--mf-color-${token}`}</code>
              </th>
              {THEME_NAMES.map((theme) => (
                <td key={theme} className="px-2 py-1">
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block size-4 rounded-sm border border-divider"
                      style={{ backgroundColor: resolved[theme][token] }}
                    />
                    <code dir="ltr" className="font-mono text-xs">
                      {`${primitiveName(THEMES[theme][token])} ${resolved[theme][token]}`}
                    </code>
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ContrastSection() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  return (
    <section id="contrast" aria-labelledby="contrast-title" className="flex flex-col gap-3">
      <h2 id="contrast-title" className="text-xl font-semibold">
        {t("sections.contrast")}
      </h2>
      {THEME_NAMES.map((theme) => {
        const results = checkContrast(resolveTheme(palette, THEMES[theme]));
        return (
          <details key={theme} className="bg-surface p-2">
            <summary className="cursor-default font-medium">
              {t("contrast.summary", {
                theme: t(`themes.${theme}`),
                count: results.length,
                failing: results.filter((result) => !result.passes).length,
              })}
            </summary>
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-field-border text-text-secondary">
                  <th className="px-2 text-start font-semibold">{t("contrast.foreground")}</th>
                  <th className="px-2 text-start font-semibold">{t("contrast.background")}</th>
                  <th className="px-2 text-end font-semibold">{t("contrast.ratio")}</th>
                  <th className="px-2 text-end font-semibold">{t("contrast.minimum")}</th>
                  <th className="px-2 text-start font-semibold">{t("contrast.result")}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((result) => (
                  <tr
                    key={`${result.foreground}/${result.background}`}
                    className="border-b border-divider"
                  >
                    <td className="px-2">
                      <code dir="ltr" className="font-mono text-xs">
                        {result.foreground}
                      </code>
                    </td>
                    <td className="px-2">
                      <code dir="ltr" className="font-mono text-xs">
                        {result.background}
                      </code>
                    </td>
                    <td className="px-2 text-end tabular-nums">{result.ratio.toFixed(2)}</td>
                    <td className="px-2 text-end tabular-nums">{result.minimum.toFixed(1)}</td>
                    <td className="px-2">
                      {result.passes ? (
                        <Badge tone="positive">{t("contrast.passes")}</Badge>
                      ) : (
                        <Badge tone="negative">{t("contrast.fails")}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
    </section>
  );
}

function TypeSection() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  return (
    <section id="type" aria-labelledby="type-title" className="flex flex-col gap-2">
      <h2 id="type-title" className="text-xl font-semibold">
        {t("sections.type")}
      </h2>
      {Object.entries(TYPE_SCALE).map(([size, { size: fontSize, lineHeight }]) => (
        <p
          key={size}
          style={{ fontSize: `${String(fontSize)}px`, lineHeight: `${String(lineHeight)}px` }}
        >
          {t("typeSample", { size: `${size} ${String(fontSize)}/${String(lineHeight)}` })}
        </p>
      ))}
    </section>
  );
}

/**
 * The component gallery (`screen-patterns.md`, replacing the token preview page): the palette,
 * semantic tokens, contrast pairs, type scale, and then every `packages/ui` component in both
 * themes and all three densities.
 */
export function ComponentGallery() {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  return (
    <ToastProvider>
      <GalleryPage title={t("title")} intro={t("intro")} />
    </ToastProvider>
  );
}

function GalleryPage({ title, intro }: { readonly title: string; readonly intro: string }) {
  const { t } = useTranslation(GALLERY_NAMESPACE);
  return (
    <main className="flex min-h-screen flex-col gap-10 bg-page p-6 text-text">
      <header className="flex flex-col gap-2">
        <h1 className="self-start border-b-4 border-double border-signature text-3xl font-bold">
          {title}
        </h1>
        <p className="text-text-secondary">{intro}</p>
      </header>
      <PaletteSection />
      <SemanticSection />
      <ContrastSection />
      <TypeSection />
      <section id="components" aria-labelledby="components-title" className="flex flex-col gap-6">
        <h2 id="components-title" className="text-xl font-semibold">
          {t("sections.components")}
        </h2>
        {THEME_NAMES.map((theme) =>
          DENSITY_NAMES.map((density) => (
            <section
              key={`${theme}-${density}`}
              aria-label={`${t(`themes.${theme}`)} — ${t(`densities.${density}`)}`}
              data-theme={theme}
              data-density={density}
              className="flex flex-col gap-4 border border-divider bg-page p-5 text-density text-text"
            >
              <h3 className="text-lg font-semibold">
                {t(`themes.${theme}`)} — {t(`densities.${density}`)}
              </h3>
              <StatesTable />
              <Specimens />
            </section>
          )),
        )}
      </section>
    </main>
  );
}
