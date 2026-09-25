import type { Ref } from "react";
import {
  TextArea as AriaTextArea,
  TextField,
  type TextFieldProps as AriaTextFieldProps,
} from "react-aria-components";
import { cx } from "./cx.ts";
import { FieldHelp, FieldLabel, INPUT_CLASS } from "./field.tsx";

export interface TextAreaProps extends Omit<
  AriaTextFieldProps,
  "className" | "children" | "style" | "validationBehavior"
> {
  readonly label: string;
  readonly description?: string | undefined;
  /** Shown, and the field marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  readonly inputRef?: Ref<HTMLTextAreaElement>;
  readonly rows?: number;
  readonly className?: string;
}

/** A labelled multi-line field (an address, a note); `Enter` adds a line. */
export function TextArea({
  label,
  description,
  errorMessage,
  inputRef,
  rows = 3,
  className,
  ...props
}: TextAreaProps) {
  return (
    <TextField
      {...props}
      validationBehavior="aria"
      isInvalid={errorMessage !== undefined || props.isInvalid === true}
      className={cx("flex flex-col gap-1", className)}
    >
      <FieldLabel>{label}</FieldLabel>
      <AriaTextArea
        ref={inputRef}
        rows={rows}
        className={cx(INPUT_CLASS, "resize-y py-pad-block")}
      />
      <FieldHelp description={description} errorMessage={errorMessage} />
    </TextField>
  );
}
