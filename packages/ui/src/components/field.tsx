import type { ReactNode } from "react";
import { FieldError, Label, Text } from "react-aria-components";
import { cx, FOCUS_RING } from "./cx.ts";

/** The input box shared by text and amount fields: `field-*` tokens on `surface` (3:1 border). */
export const INPUT_CLASS = cx(
  "min-h-control w-full min-w-0 rounded-sm border border-field-border bg-field-bg px-pad-inline text-density text-field-text data-[invalid]:border-text-negative",
  FOCUS_RING,
);

export function FieldLabel({ children }: { readonly children: ReactNode }) {
  return <Label className="text-sm font-medium text-text">{children}</Label>;
}

/** Help under a field, then its error: the error is text, never colour alone. */
export function FieldHelp({
  description,
  errorMessage,
}: {
  readonly description?: string | undefined;
  readonly errorMessage?: string | undefined;
}) {
  return (
    <>
      {description === undefined ? null : (
        <Text slot="description" className="text-xs text-text-secondary">
          {description}
        </Text>
      )}
      <FieldError className="text-xs font-medium text-text-negative">{errorMessage}</FieldError>
    </>
  );
}
