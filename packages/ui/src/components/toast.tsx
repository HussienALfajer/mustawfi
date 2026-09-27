import { CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button as AriaButton } from "react-aria-components";
import { useTranslation } from "react-i18next";
import { cx } from "./cx.ts";
import { ICON_BUTTON } from "./interaction.ts";
import { UI_NAMESPACE } from "./messages.ts";

/**
 * What a toast may say. There is no error tone on purpose: a failure that matters stays on the
 * screen where it happened until it is resolved (`design-system.md`, pattern 6); a toast only
 * confirms, informs, or warns about something already done.
 */
export type ToastTone = "success" | "info" | "warning";

export interface ToastOptions {
  readonly tone?: ToastTone;
}

interface ToastItem {
  readonly id: number;
  readonly message: string;
  readonly tone: ToastTone;
}

export interface ToastApi {
  /** Shows a short message at the screen's end corner; it closes by itself. */
  readonly show: (message: string, options?: ToastOptions) => void;
}

/** How long a toast stays, unless the pointer or the focus is on it. */
export const TOAST_DURATION_MS: Record<ToastTone, number> = {
  success: 5000,
  info: 6000,
  warning: 8000,
};

/** At most this many at once; the oldest goes first. */
const MAX_TOASTS = 3;

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Shows toasts from anywhere under it (`useToast`). Mount it once, at the app's root: the
 * toasts sit in one labelled region whose polite live list reads each new one out.
 */
export function ToastProvider({ children }: { readonly children: ReactNode }) {
  const { t } = useTranslation(UI_NAMESPACE);
  const [toasts, setToasts] = useState<readonly ToastItem[]>([]);
  const nextId = useRef(1);
  const show = useCallback((message: string, options?: ToastOptions) => {
    const id = nextId.current++;
    setToasts((current) =>
      [...current, { id, message, tone: options?.tone ?? "success" }].slice(-MAX_TOASTS),
    );
  }, []);
  const close = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext value={api}>
      {children}
      <section
        aria-label={t("toast.region")}
        className="pointer-events-none fixed end-4 bottom-4 z-[60] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col"
      >
        <ol aria-live="polite" aria-relevant="additions" className="flex flex-col gap-2">
          {toasts.map((toast) => (
            <TimedToast key={toast.id} toast={toast} onClose={close} />
          ))}
        </ol>
      </section>
    </ToastContext>
  );
}

const TONES: Record<ToastTone, { readonly box: string; readonly icon: ReactNode }> = {
  success: {
    box: "bg-positive-tint",
    icon: <CircleCheck size={18} strokeWidth={2} className="text-text-positive" />,
  },
  info: {
    box: "bg-info-tint",
    icon: <Info size={18} strokeWidth={2} className="text-text-info" />,
  },
  warning: {
    box: "bg-warning-tint",
    icon: <TriangleAlert size={18} strokeWidth={2} className="text-text-warning" />,
  },
};

export interface ToastProps {
  readonly tone: ToastTone;
  readonly message: string;
  /** Shows the close button; a toast shown by `ToastProvider` always has one. */
  readonly onClose?: () => void;
}

/** One toast as it looks: its tone's tint and icon, the message, and a close button. */
export function Toast({ tone, message, onClose }: ToastProps) {
  const { t } = useTranslation(UI_NAMESPACE);
  const look = TONES[tone];
  return (
    <div
      data-tone={tone}
      className={cx(
        "pointer-events-auto flex items-start gap-2 rounded-md border border-divider ps-3 pe-1 py-1 text-sm text-text shadow-floating",
        look.box,
      )}
    >
      <span aria-hidden="true" className="flex min-h-control items-center">
        {look.icon}
      </span>
      <p className="flex min-h-control flex-1 items-center py-1">{message}</p>
      {onClose === undefined ? null : (
        <AriaButton aria-label={t("toast.close")} onPress={onClose} className={ICON_BUTTON}>
          <X aria-hidden="true" size={16} strokeWidth={1.75} />
        </AriaButton>
      )}
    </div>
  );
}

/** A shown toast: it closes by itself, but not while the pointer or the focus is on it. */
function TimedToast({
  toast,
  onClose,
}: {
  readonly toast: ToastItem;
  readonly onClose: (id: number) => void;
}) {
  // Held while the pointer is on it or the focus is in it; either alone keeps it.
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = pointer || focus;
  useEffect(() => {
    if (held) return;
    const timer = window.setTimeout(() => {
      onClose(toast.id);
    }, TOAST_DURATION_MS[toast.tone]);
    return () => {
      window.clearTimeout(timer);
    };
  }, [held, onClose, toast.id, toast.tone]);
  return (
    <li
      onPointerEnter={() => {
        setPointer(true);
      }}
      onPointerLeave={() => {
        setPointer(false);
      }}
      onFocus={() => {
        setFocus(true);
      }}
      onBlur={() => {
        setFocus(false);
      }}
    >
      <Toast
        tone={toast.tone}
        message={toast.message}
        onClose={() => {
          onClose(toast.id);
        }}
      />
    </li>
  );
}

/** The toasts of the nearest `ToastProvider`. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error("useToast needs a ToastProvider above it");
  return api;
}
