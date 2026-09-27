import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./button.tsx";
import { UI_NAMESPACE } from "./messages.ts";

export interface CopyButtonProps {
  /** The text copied to the clipboard. */
  readonly value: string;
  /**
   * What is copied, for assistive tech («رمز التسجيل»): the button reads «نسخ رمز التسجيل», so
   * two copy buttons on one screen are told apart.
   */
  readonly label: string;
  readonly className?: string;
}

type CopyState = "idle" | "copied" | "failed";

/** How long «نُسخ» or the refusal stays before the button reads «نسخ» again. */
export const COPY_FEEDBACK_MS = 2000;

/**
 * Copies a value the user must carry elsewhere — a registration code, recovery codes, a 2FA
 * key — next to where it is shown. The button says «نُسخ» for two seconds after copying; when
 * the clipboard refuses (no permission), it says so, and the value stays on screen to copy by
 * hand. The outcome is read out by a polite live status.
 */
export function CopyButton({ value, label, className }: CopyButtonProps) {
  const { t } = useTranslation(UI_NAMESPACE);
  const [state, setState] = useState<CopyState>("idle");
  // Each copy restarts the feedback, even when the button already says «نُسخ».
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (state === "idle") return;
    const timer = window.setTimeout(() => {
      setState("idle");
    }, COPY_FEEDBACK_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [state, attempt]);
  const copy = () => {
    setAttempt((count) => count + 1);
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      setState("failed");
      return;
    }
    clipboard.writeText(value).then(
      () => {
        setState("copied");
      },
      () => {
        setState("failed");
      },
    );
  };
  return (
    <span className="inline-flex items-center">
      <Button variant="quiet" onPress={copy} {...(className === undefined ? {} : { className })}>
        {state === "copied" ? (
          <Check aria-hidden="true" size={16} strokeWidth={2} />
        ) : (
          <Copy aria-hidden="true" size={16} strokeWidth={1.75} />
        )}
        <span>
          {state === "copied" ? t("copy.done") : t("copy.action")}{" "}
          <span className="sr-only">{label}</span>
        </span>
      </Button>
      <span role="status" className={state === "failed" ? "text-xs text-text-warning" : "sr-only"}>
        {state === "copied"
          ? t("copy.doneFor", { label })
          : state === "failed"
            ? t("copy.failed")
            : ""}
      </span>
    </span>
  );
}
