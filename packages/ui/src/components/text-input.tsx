import type { Ref } from "react";
import { Input, TextField, type TextFieldProps as AriaTextFieldProps } from "react-aria-components";
import { cx } from "./cx.ts";
import { FieldHelp, FieldLabel, INPUT_CLASS } from "./field.tsx";

export interface TextInputProps extends Omit<
  AriaTextFieldProps,
  "className" | "children" | "style" | "validationBehavior"
> {
  readonly label: string;
  readonly description?: string | undefined;
  /** Shown, and the field marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement>;
  /** `ltr` for machine text — codes, logins, barcodes — so it never displays reordered. */
  readonly dir?: "ltr" | "rtl" | "auto";
  readonly className?: string;
}

/** A labelled text field on React Aria; the label, help, and error are wired for assistive tech. */
export function TextInput({
  label,
  description,
  errorMessage,
  inputRef,
  dir,
  className,
  ...props
}: TextInputProps) {
  return (
    <TextField
      {...props}
      validationBehavior="aria"
      isInvalid={errorMessage !== undefined || props.isInvalid === true}
      className={cx("flex flex-col gap-1", className)}
    >
      <FieldLabel>{label}</FieldLabel>
      <Input
        ref={inputRef}
        {...(dir === undefined ? {} : { dir })}
        className={cx(INPUT_CLASS, dir === "ltr" && "text-end")}
      />
      <FieldHelp description={description} errorMessage={errorMessage} />
    </TextField>
  );
}
