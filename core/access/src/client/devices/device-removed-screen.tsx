import { Button } from "@mustawfi/ui";
import { MonitorX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ACCESS_NAMESPACE } from "../messages.ts";

export interface DeviceRemovedScreenProps {
  /** The one thing to do: go on, to registering this client again. */
  readonly onContinue: () => void;
}

/**
 * «This device was removed from the store» (flow 17, notice pattern): shown in place of the app
 * once a revoked device has sent everything and wiped its data, until the user goes on.
 */
export function DeviceRemovedScreen({ onContinue }: DeviceRemovedScreenProps) {
  const { t } = useTranslation(ACCESS_NAMESPACE);
  return (
    <main className="flex min-h-screen items-center justify-center bg-page p-4">
      <section
        aria-labelledby="device-removed-title"
        className="flex max-w-md flex-col gap-4 rounded-md border border-divider bg-surface p-6"
      >
        <MonitorX aria-hidden="true" size={32} strokeWidth={1.75} className="text-text-negative" />
        <h1 id="device-removed-title" className="text-xl font-bold text-text">
          {t("device.removed.title")}
        </h1>
        <p className="text-text">{t("device.removed.body")}</p>
        <p className="text-text-secondary">{t("device.removed.next")}</p>
        <div>
          <Button autoFocus onPress={onContinue}>
            {t("device.removed.action")}
          </Button>
        </div>
      </section>
    </main>
  );
}
