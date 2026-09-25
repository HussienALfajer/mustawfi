import { Check } from "lucide-react";
import { type ReactNode, useId } from "react";
import {
  Checkbox as AriaCheckbox,
  CheckboxGroup as AriaCheckboxGroup,
  Label,
} from "react-aria-components";
import { cx } from "./cx.ts";
import { FieldHelp } from "./field.tsx";

export interface CheckboxProps {
  readonly children: ReactNode;
  /** Standalone: whether it is checked. Inside a `CheckboxGroup`, the group holds the state. */
  readonly isSelected?: boolean;
  readonly onChange?: (isSelected: boolean) => void;
  /** Inside a `CheckboxGroup`: the value it adds to the group's list. */
  readonly value?: string;
  readonly isReadOnly?: boolean;
  readonly isDisabled?: boolean;
  /** Help under the label, part of the checkbox's accessible description. */
  readonly description?: string | undefined;
  readonly className?: string;
}

/** A labelled checkbox; the box has a 3:1 boundary and the check is drawn, not only coloured. */
export function Checkbox({
  children,
  isSelected,
  onChange,
  value,
  isReadOnly,
  isDisabled,
  description,
  className,
}: CheckboxProps) {
  const descriptionId = useId();
  return (
    <AriaCheckbox
      {...(description === undefined ? {} : { "aria-describedby": descriptionId })}
      {...(isSelected === undefined ? {} : { isSelected })}
      {...(onChange === undefined ? {} : { onChange })}
      {...(value === undefined ? {} : { value })}
      {...(isReadOnly === undefined ? {} : { isReadOnly })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      className={cx(
        "group flex min-h-control cursor-default items-start gap-2 py-1 text-density text-text data-[disabled]:opacity-60",
        className,
      )}
    >
      {({ isSelected: checked }) => (
        <>
          <span
            aria-hidden="true"
            className={cx(
              "mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-sm border border-field-border bg-field-bg",
              "group-data-[focus-visible]:outline-2 group-data-[focus-visible]:outline-offset-2 group-data-[focus-visible]:outline-focus-ring",
              "group-data-[selected]:border-accent group-data-[selected]:bg-accent group-data-[selected]:text-text-on-accent",
            )}
          >
            {checked ? <Check size={14} strokeWidth={3} /> : null}
          </span>
          <span className="flex flex-col">
            <span>{children}</span>
            {description === undefined ? null : (
              <span id={descriptionId} className="text-xs text-text-secondary">
                {description}
              </span>
            )}
          </span>
        </>
      )}
    </AriaCheckbox>
  );
}

export interface CheckboxGroupProps {
  readonly label: string;
  readonly value: readonly string[];
  readonly onChange: (value: string[]) => void;
  readonly children: ReactNode;
  readonly description?: string | undefined;
  /** Shown, and the group marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  readonly isReadOnly?: boolean;
  readonly className?: string;
}

/** Several choices under one label (the departments of a user's scope). */
export function CheckboxGroup({
  label,
  value,
  onChange,
  children,
  description,
  errorMessage,
  isReadOnly,
  className,
}: CheckboxGroupProps) {
  return (
    <AriaCheckboxGroup
      value={[...value]}
      onChange={onChange}
      {...(isReadOnly === undefined ? {} : { isReadOnly })}
      validationBehavior="aria"
      isInvalid={errorMessage !== undefined}
      className={cx("flex flex-col gap-1", className)}
    >
      <Label className="text-sm font-medium text-text">{label}</Label>
      <div className="flex flex-col">{children}</div>
      <FieldHelp description={description} errorMessage={errorMessage} />
    </AriaCheckboxGroup>
  );
}
