import type { Clock, IdGenerator } from "@mustawfi/kernel";
import { createContext, type ReactNode, useContext } from "react";

/**
 * What the app, as composition root, hands module screens: the clock and the id generator
 * (domain code never reads the ambient clock or randomness, ADR-0015 rule 6).
 */
export interface ClientRuntime {
  readonly clock: Clock;
  readonly newId: IdGenerator;
}

const ClientRuntimeContext = createContext<ClientRuntime | undefined>(undefined);

export function ClientRuntimeProvider(props: {
  readonly runtime: ClientRuntime;
  readonly children: ReactNode;
}) {
  return (
    <ClientRuntimeContext.Provider value={props.runtime}>
      {props.children}
    </ClientRuntimeContext.Provider>
  );
}

export function useClientRuntime(): ClientRuntime {
  const runtime = useContext(ClientRuntimeContext);
  if (runtime === undefined) throw new Error("useClientRuntime outside ClientRuntimeProvider");
  return runtime;
}
