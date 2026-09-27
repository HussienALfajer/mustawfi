import { Eye, EyeOff } from "lucide-react";
import { type Ref, useState } from "react";
import {
  Group,
  Input,
  TextField,
  type TextFieldProps as AriaTextFieldProps,
  ToggleButton,
} from "react-aria-components";
import { useTranslation } from "react-i18next";
import { cx, FOCUS_RING_INSET } from "./cx.ts";
import { FieldHelp, FieldLabel, westernDigitsOnChange } from "./field.tsx";
import { ICON_BUTTON } from "./interaction.ts";
import { UI_NAMESPACE } from "./messages.ts";

export interface PasswordFieldProps extends Omit<
  AriaTextFieldProps,
  "className" | "children" | "style" | "validationBehavior" | "type"
> {
  readonly label: string;
  readonly description?: string | undefined;
  /** Shown, and the field marked invalid, whenever it is set. */
  readonly errorMessage?: string | undefined;
  /**
   * `numeric` for a PIN: the phone and tablet keyboards show digits, and Arabic-Indic digits
   * typed on an Arabic keyboard become Western ones (as in a one-time code).
   */
  readonly inputMode?: "text" | "numeric";
  readonly maxLength?: number;
  readonly inputRef?: Ref<HTMLInputElement>;
  readonly className?: string;
}

/**
 * A secret the user types — a password, a PIN, a reset code — hidden by default, with a toggle
 * that shows it while the user checks what they typed. The value is machine text, so it reads
 * left to right. The toggle is a pressed/not-pressed button with its own name, reachable by
 * keyboard; `Enter` in the field never reaches it.
 */
export function PasswordField({
  label,
  description,
  errorMessage,
  inputMode,
  maxLength,
  inputRef,
  className,
  ...props
}: PasswordFieldProps) {
  const { t } = useTranslation(UI_NAMESPACE);
  const [revealed, setRevealed] = useState(false);
  // A field emptied from outside (a form reset after a save) hides again, so the next secret
  // typed there is not shown by a toggle left on.
  if (revealed && props.value === "") setRevealed(false);
  const invalid = errorMessage !== undefined || props.isInvalid === true;
  const onChange = westernDigitsOnChange(props.onChange, inputMode, props.autoComplete);
  const onChangeProp = onChange === undefined ? {} : { onChange };
  return (
    <TextField
      {...props}
      {...onChangeProp}
      type={revealed ? "text" : "password"}
      validationBehavior="aria"
      isInvalid={invalid}
      className={cx("flex flex-col gap-1", className)}
    >
      <FieldLabel>{label}</FieldLabel>
      {/* The box is the group, so the toggle sits inside the border at the end side. */}
      <Group
        isInvalid={invalid}
        className={cx(
          "flex min-h-control w-full min-w-0 rounded-sm border border-field-border bg-field-bg data-[invalid]:border-text-negative",
          "has-[input[data-focus-visible]]:outline-solid has-[input[data-focus-visible]]:outline-2 has-[input[data-focus-visible]]:outline-focus-ring has-[input[data-focus-visible]]:outline-offset-2",
        )}
      >
        <Input
          ref={inputRef}
          dir="ltr"
          spellCheck={false}
          {...(inputMode === undefined ? {} : { inputMode })}
          {...(maxLength === undefined ? {} : { maxLength })}
          className="min-w-0 flex-1 bg-transparent px-pad-inline text-end text-density text-field-text outline-none"
        />
        <ToggleButton
          isSelected={revealed}
          onChange={setRevealed}
          aria-label={t("passwordField.reveal")}
          className={cx(ICON_BUTTON, "min-h-0 rounded-sm", FOCUS_RING_INSET)}
        >
          {revealed ? (
            <EyeOff aria-hidden="true" size={16} strokeWidth={1.75} />
          ) : (
            <Eye aria-hidden="true" size={16} strokeWidth={1.75} />
          )}
        </ToggleButton>
      </Group>
      <FieldHelp description={description} errorMessage={errorMessage} />
    </TextField>
  );
}
