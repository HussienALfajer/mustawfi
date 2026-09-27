import {
  type CalendarDate,
  endOfMonth,
  parseDate,
  startOfMonth,
  today,
} from "@internationalized/date";
import { DEFAULT_TIME_ZONE, LOCALE } from "@mustawfi/i18n";
import { CalendarDays, ChevronLeft } from "lucide-react";
import { type ReactNode, useContext } from "react";
import {
  Button as AriaButton,
  Calendar,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DatePicker as AriaDatePicker,
  DatePickerStateContext,
  DateRangePicker as AriaDateRangePicker,
  DateRangePickerStateContext,
  DateSegment,
  Dialog,
  Group,
  Heading,
  I18nProvider,
  Label,
  Popover,
  RangeCalendar,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { cx, FOCUS_RING_INSET } from "./cx.ts";
import { FieldHelp, FieldLabel } from "./field.tsx";
import { ICON_BUTTON, PRESSABLE } from "./interaction.ts";
import { UI_NAMESPACE } from "./messages.ts";

/**
 * Dates are Arabic as used in Syria with Western digits (the app's default), day first:
 * `dd/mm/yyyy`. The digits of a date are machine text, so the field reads left to right.
 */
const DATE_LOCALE = `${LOCALE}-u-nu-latn`;

/** A date range, both ends included, as ISO dates (`2026-09-27`). */
export interface DateRangeValue {
  readonly start: string;
  readonly end: string;
}

/** A named range offered beside the calendar: «اليوم», «آخر 7 أيام», «الشهر الماضي». */
export type DatePreset = "today" | "yesterday" | "last7" | "last30" | "thisMonth" | "lastMonth";

const RANGE_PRESETS: readonly DatePreset[] = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "thisMonth",
  "lastMonth",
];
const DATE_PRESETS: readonly DatePreset[] = ["today", "yesterday"];

/** The range a preset names, on the store's calendar (Damascus), whatever the device's zone. */
export function presetRange(
  preset: DatePreset,
  now: CalendarDate = today(DEFAULT_TIME_ZONE),
): { readonly start: CalendarDate; readonly end: CalendarDate } {
  switch (preset) {
    case "today":
      return { start: now, end: now };
    case "yesterday": {
      const day = now.subtract({ days: 1 });
      return { start: day, end: day };
    }
    case "last7":
      return { start: now.subtract({ days: 6 }), end: now };
    case "last30":
      return { start: now.subtract({ days: 29 }), end: now };
    case "thisMonth":
      return { start: startOfMonth(now), end: now };
    case "lastMonth": {
      const month = startOfMonth(now).subtract({ months: 1 });
      return { start: month, end: endOfMonth(month) };
    }
  }
}

function toDate(value: string | null | undefined): CalendarDate | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

const BOX = cx(
  "flex min-h-control w-full min-w-0 items-center rounded-sm border border-field-border bg-field-bg text-field-text",
  "has-[[role=spinbutton][data-focused]]:outline-solid has-[[role=spinbutton][data-focused]]:outline-2 has-[[role=spinbutton][data-focused]]:outline-focus-ring has-[[role=spinbutton][data-focused]]:outline-offset-2",
  "data-[invalid]:border-text-negative",
);

const SEGMENT = cx(
  "rounded-sm px-px tabular-nums outline-none",
  "data-[placeholder]:text-text-secondary data-[type=literal]:px-0 data-[type=literal]:text-text-secondary",
  "data-[focused]:bg-accent data-[focused]:text-text-on-accent",
);

function Segments({ slot }: { readonly slot?: "start" | "end" }) {
  return (
    <DateInput {...(slot === undefined ? {} : { slot })} dir="ltr" className="flex items-center">
      {(segment) => <DateSegment segment={segment} className={SEGMENT} />}
    </DateInput>
  );
}

function CalendarButton() {
  const { t } = useTranslation(UI_NAMESPACE);
  return (
    <AriaButton
      aria-label={t("datePicker.open")}
      className={cx(ICON_BUTTON, "ms-auto min-h-0 self-stretch")}
    >
      <CalendarDays aria-hidden="true" size={16} strokeWidth={1.75} />
    </AriaButton>
  );
}

function RangeSeparator() {
  const { t } = useTranslation(UI_NAMESPACE);
  return (
    <span aria-hidden="true" className="text-text-secondary">
      {t("datePicker.rangeSeparator")}
    </span>
  );
}

function CalendarHeader() {
  const { t } = useTranslation(UI_NAMESPACE);
  // The chevrons point along the reading direction: back is toward the start side.
  return (
    <header className="flex items-center gap-2 pb-2">
      <AriaButton slot="previous" aria-label={t("datePicker.previous")} className={ICON_BUTTON}>
        <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.75} className="rtl:rotate-180" />
      </AriaButton>
      <Heading className="flex-1 text-center text-sm font-semibold" />
      <AriaButton slot="next" aria-label={t("datePicker.next")} className={ICON_BUTTON}>
        <ChevronLeft aria-hidden="true" size={16} strokeWidth={1.75} className="ltr:rotate-180" />
      </AriaButton>
    </header>
  );
}

const CELL = cx(
  "flex size-8 items-center justify-center rounded-sm text-sm tabular-nums",
  PRESSABLE,
  "data-[outside-month]:hidden data-[disabled]:text-text-secondary data-[unavailable]:line-through",
  "data-[today]:font-bold data-[today]:underline data-[today]:underline-offset-4",
  "data-[hovered]:bg-state-hover-bg data-[pressed]:bg-state-pressed-bg",
  FOCUS_RING_INSET,
);

function Grid({ cell }: { readonly cell: string }) {
  return (
    <CalendarGrid className="border-separate border-spacing-0.5">
      <CalendarGridHeader>
        {(day) => (
          <CalendarHeaderCell className="size-8 text-xs font-medium text-text-secondary">
            {day}
          </CalendarHeaderCell>
        )}
      </CalendarGridHeader>
      <CalendarGridBody>
        {(date) => <CalendarCell date={date} className={cx(CELL, cell)} />}
      </CalendarGridBody>
    </CalendarGrid>
  );
}

function PresetList({
  presets,
  onPick,
}: {
  readonly presets: readonly DatePreset[];
  readonly onPick: (preset: DatePreset) => void;
}) {
  const { t } = useTranslation(UI_NAMESPACE);
  return (
    <ul
      aria-label={t("datePicker.presets")}
      className="flex min-w-32 flex-col gap-0.5 border-e border-divider pe-2"
    >
      {presets.map((preset) => (
        <li key={preset}>
          <AriaButton
            onPress={() => {
              onPick(preset);
            }}
            className={cx(
              "flex min-h-8 w-full items-center rounded-sm px-2 text-start text-sm text-text",
              PRESSABLE,
              "data-[hovered]:bg-state-hover-bg data-[pressed]:bg-state-pressed-bg",
              FOCUS_RING_INSET,
            )}
          >
            {t(`datePicker.preset.${preset}`)}
          </AriaButton>
        </li>
      ))}
    </ul>
  );
}

function PickerPopover({ children }: { readonly children: ReactNode }) {
  return (
    <Popover
      placement="bottom start"
      className="rounded-sm border border-divider bg-surface text-text shadow-floating"
    >
      <Dialog className="flex gap-3 p-3 outline-none">{children}</Dialog>
    </Popover>
  );
}

function DatePresets({ presets }: { readonly presets: readonly DatePreset[] }) {
  const state = useContext(DatePickerStateContext);
  return (
    <PresetList
      presets={presets}
      onPick={(preset) => {
        state?.setValue(presetRange(preset).start);
        state?.setOpen(false);
      }}
    />
  );
}

function RangePresets({ presets }: { readonly presets: readonly DatePreset[] }) {
  const state = useContext(DateRangePickerStateContext);
  return (
    <PresetList
      presets={presets}
      onPick={(preset) => {
        state?.setValue(presetRange(preset));
        state?.setOpen(false);
      }}
    />
  );
}

interface PickerFieldProps {
  readonly label: string;
  /** In a filter bar the label is read out but not shown; the value says what it filters. */
  readonly labelHidden?: boolean;
  readonly description?: string | undefined;
  /** Shown, and the field marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  /** The earliest and latest dates allowed, as ISO dates. */
  readonly minValue?: string;
  readonly maxValue?: string;
  /** Named dates beside the calendar; `[]` for none. */
  readonly presets?: readonly DatePreset[];
  readonly className?: string;
}

export interface DatePickerProps extends PickerFieldProps {
  /** An ISO date (`2026-09-27`), or `null` when empty. */
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
}

function PickerLabel({ label, hidden }: { readonly label: string; readonly hidden: boolean }) {
  return hidden ? <Label className="sr-only">{label}</Label> : <FieldLabel>{label}</FieldLabel>;
}

function bounds(props: PickerFieldProps) {
  const min = toDate(props.minValue);
  const max = toDate(props.maxValue);
  return { ...(min === null ? {} : { minValue: min }), ...(max === null ? {} : { maxValue: max }) };
}

/**
 * One date, typed as `dd/mm/yyyy` (each part takes digits and the arrow keys) or picked from a
 * calendar in Arabic, right to left, with «اليوم» and «أمس» on the store's calendar (Damascus).
 */
export function DatePicker(props: DatePickerProps) {
  const { label, labelHidden = false, description, errorMessage, value, onChange } = props;
  const presets = props.presets ?? DATE_PRESETS;
  return (
    <I18nProvider locale={DATE_LOCALE}>
      <AriaDatePicker
        value={toDate(value)}
        onChange={(date) => {
          onChange(date === null ? null : date.toString());
        }}
        {...bounds(props)}
        shouldForceLeadingZeros
        validationBehavior="aria"
        isInvalid={errorMessage !== undefined}
        className={cx("flex flex-col gap-1", props.className)}
      >
        <PickerLabel label={label} hidden={labelHidden} />
        <Group className={cx(BOX, "ps-pad-inline")}>
          <Segments />
          <CalendarButton />
        </Group>
        <FieldHelp description={description} errorMessage={errorMessage} />
        <PickerPopover>
          {presets.length === 0 ? null : <DatePresets presets={presets} />}
          <Calendar>
            <CalendarHeader />
            <Grid cell="data-[selected]:bg-accent data-[selected]:text-text-on-accent" />
          </Calendar>
        </PickerPopover>
      </AriaDatePicker>
    </I18nProvider>
  );
}

export interface DateRangePickerProps extends PickerFieldProps {
  /** Both ends included, or `null` when empty. */
  readonly value: DateRangeValue | null;
  readonly onChange: (value: DateRangeValue | null) => void;
}

/**
 * A range of dates, both ends included — typed as two `dd/mm/yyyy` dates or picked on one
 * calendar — with presets from «اليوم» to «الشهر الماضي» on the store's calendar (Damascus).
 * The end can never come before the start.
 */
export function DateRangePicker(props: DateRangePickerProps) {
  const { label, labelHidden = false, description, errorMessage, value, onChange } = props;
  const presets = props.presets ?? RANGE_PRESETS;
  const start = toDate(value?.start);
  const end = toDate(value?.end);
  return (
    <I18nProvider locale={DATE_LOCALE}>
      <AriaDateRangePicker
        value={start === null || end === null ? null : { start, end }}
        onChange={(range) => {
          onChange(
            range === null ? null : { start: range.start.toString(), end: range.end.toString() },
          );
        }}
        {...bounds(props)}
        shouldForceLeadingZeros
        validationBehavior="aria"
        isInvalid={errorMessage !== undefined}
        className={cx("flex flex-col gap-1", props.className)}
      >
        <PickerLabel label={label} hidden={labelHidden} />
        <Group className={cx(BOX, "gap-1 ps-pad-inline")}>
          <Segments slot="start" />
          <RangeSeparator />
          <Segments slot="end" />
          <CalendarButton />
        </Group>
        <FieldHelp description={description} errorMessage={errorMessage} />
        <PickerPopover>
          {presets.length === 0 ? null : <RangePresets presets={presets} />}
          <RangeCalendar>
            <CalendarHeader />
            <Grid
              cell={cx(
                "data-[selected]:rounded-none data-[selected]:bg-state-selected-bg",
                "data-[selection-start]:rounded-sm data-[selection-start]:bg-accent data-[selection-start]:text-text-on-accent",
                "data-[selection-end]:rounded-sm data-[selection-end]:bg-accent data-[selection-end]:text-text-on-accent",
              )}
            />
          </RangeCalendar>
        </PickerPopover>
      </AriaDateRangePicker>
    </I18nProvider>
  );
}
