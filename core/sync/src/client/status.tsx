import { Button } from "@mustawfi/ui";
import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import type { SyncEngine, SyncPhase, SyncStatus } from "./engine.ts";
import { SYNC_NAMESPACE } from "./messages.ts";

const SyncEngineContext = createContext<SyncEngine | undefined>(undefined);

export function SyncEngineProvider(props: {
  readonly engine: SyncEngine;
  readonly children: ReactNode;
}) {
  return (
    <SyncEngineContext.Provider value={props.engine}>{props.children}</SyncEngineContext.Provider>
  );
}

export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncEngineContext);
  if (engine === undefined) throw new Error("useSyncEngine outside SyncEngineProvider");
  return engine;
}

export function useSyncStatus(): SyncStatus {
  const engine = useSyncEngine();
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    () => engine.status(),
  );
}

const PHASE_TONE: Record<SyncPhase, string> = {
  unregistered: "text-text-secondary",
  idle: "text-text-positive",
  syncing: "text-text-secondary",
  offline: "text-text-warning",
  failed: "text-text-negative",
  revoked: "text-text-warning",
  removed: "text-text-negative",
};

/**
 * Whether sales are reaching the server (ADR-0024: in words, not colour alone): the phase, the
 * operations waiting in the outbox, and the rejected ones kept for review. It never blocks.
 */
export function SyncStatusIndicator() {
  const { t } = useTranslation(SYNC_NAMESPACE);
  const engine = useSyncEngine();
  const status = useSyncStatus();
  return (
    <div
      role="status"
      aria-label={t("status.label")}
      className="flex items-center gap-3 text-sm"
      data-phase={status.phase}
    >
      <span className={PHASE_TONE[status.phase]} data-testid="sync-phase">
        {t(`status.${status.phase}`)}
      </span>
      {status.phase === "unregistered" || status.phase === "removed" ? null : (
        <span className="text-text-secondary" data-testid="sync-pending">
          {t("status.pending", { count: status.pending })}
        </span>
      )}
      {status.needsReview > 0 ? (
        <span className="text-text-negative" data-testid="sync-needs-review">
          {t("status.needsReview", { count: status.needsReview })}
        </span>
      ) : null}
      {status.phase === "offline" || status.phase === "failed" ? (
        <Button
          variant="quiet"
          onPress={() => {
            void engine.syncNow();
          }}
        >
          {t("status.syncNow")}
        </Button>
      ) : null}
    </div>
  );
}
