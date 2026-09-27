import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { cx } from "./cx.ts";
import { SEGMENT_STATES } from "./interaction.ts";

export interface SegmentedOption<K extends string> {
  readonly id: K;
  readonly label: string;
}

export interface SegmentedControlProps<K extends string> {
  /** The group's accessible name. */
  readonly label: string;
  readonly options: readonly SegmentedOption<K>[];
  readonly value: K;
  readonly onChange: (value: K) => void;
  readonly className?: string;
}

/** One choice among a few, in a filter bar (status: active, archived, all). Arrow keys move. */
export function SegmentedControl<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: SegmentedControlProps<K>) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const [next] = [...keys];
        const option = options.find((candidate) => candidate.id === next);
        if (option !== undefined) onChange(option.id);
      }}
      className={cx(
        "inline-flex overflow-hidden rounded-sm border border-field-border bg-surface",
        className,
      )}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className={cx("h-[26px] px-2.5 text-sm text-text", SEGMENT_STATES)}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
