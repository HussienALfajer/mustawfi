import { ChevronDown } from "lucide-react";
import {
  Button as AriaButton,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  Select as AriaSelect,
  SelectValue,
} from "react-aria-components";
import { cx } from "./cx.ts";
import { FieldHelp, FieldLabel, INPUT_CLASS } from "./field.tsx";

export interface SelectOption<K extends string> {
  readonly id: K;
  readonly label: string;
}

export interface SelectProps<K extends string> {
  readonly label: string;
  readonly options: readonly SelectOption<K>[];
  /** The chosen option, or `null` for none (the placeholder shows). */
  readonly value: K | null;
  readonly onChange: (value: K) => void;
  readonly placeholder?: string;
  readonly description?: string | undefined;
  /** Shown, and the field marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  readonly isDisabled?: boolean;
  readonly autoFocus?: boolean;
  /** In a filter bar the label is read out but not shown; the chosen value says what it filters. */
  readonly labelHidden?: boolean;
  readonly className?: string;
}

/**
 * One choice from a list too long for a segmented control (a role, a department). A labelled
 * button opens the list; the arrow keys choose, and typing jumps to an option.
 */
export function Select<K extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  description,
  errorMessage,
  isDisabled,
  autoFocus,
  labelHidden = false,
  className,
}: SelectProps<K>) {
  return (
    <AriaSelect
      value={value}
      onChange={(key) => {
        const option = options.find((candidate) => candidate.id === key);
        if (option !== undefined) onChange(option.id);
      }}
      {...(placeholder === undefined ? {} : { placeholder })}
      {...(isDisabled === undefined ? {} : { isDisabled })}
      {...(autoFocus === undefined ? {} : { autoFocus })}
      validationBehavior="aria"
      isInvalid={errorMessage !== undefined}
      className={cx("flex flex-col gap-1", className)}
    >
      {labelHidden ? <Label className="sr-only">{label}</Label> : <FieldLabel>{label}</FieldLabel>}
      <AriaButton
        className={cx(
          INPUT_CLASS,
          "flex cursor-default items-center gap-2 text-start data-[disabled]:opacity-60",
        )}
      >
        <SelectValue className="flex-1 truncate data-[placeholder]:text-text-secondary" />
        <ChevronDown aria-hidden="true" size={16} strokeWidth={1.75} />
      </AriaButton>
      <FieldHelp description={description} errorMessage={errorMessage} />
      <Popover className="min-w-(--trigger-width) overflow-auto rounded-sm border border-divider bg-surface text-text shadow-floating">
        <ListBox className="max-h-72 p-1 outline-none" items={options}>
          {(option) => (
            <ListBoxItem
              id={option.id}
              textValue={option.label}
              className="cursor-default rounded-sm px-pad-inline py-1.5 text-density outline-none data-[focused]:bg-sunken data-[selected]:bg-selected data-[selected]:font-semibold data-[selected]:text-text-accent"
            >
              {option.label}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaSelect>
  );
}
