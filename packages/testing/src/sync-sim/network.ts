import type { SimRandom } from "./random.ts";

/**
 * How often each fault strikes a request, from 0 to 1; at most one strikes a given request,
 * so the rates add up to at most 1.
 *
 * - `dropRequest`: lost on the way; the server never sees it.
 * - `dropResponse`: the server handles it, and the answer is lost.
 * - `duplicate`: the server receives it twice at once; the client gets either answer.
 * - `delay`: the client gives up waiting; the request reaches the server later, after newer
 *   ones (`deliverLate`) — a stale retry arriving out of order.
 */
export interface FaultRates {
  readonly dropRequest: number;
  readonly dropResponse: number;
  readonly duplicate: number;
  readonly delay: number;
}

export const NO_FAULTS: FaultRates = { dropRequest: 0, dropResponse: 0, duplicate: 0, delay: 0 };

export interface LinkStats {
  /** Requests the client made. */
  requests: number;
  /** Answers the client received. */
  answered: number;
  /** Refused at once because the link was offline. */
  offline: number;
  droppedRequests: number;
  droppedResponses: number;
  duplicated: number;
  delayed: number;
  /** Delayed requests that reached the server later. */
  lateDelivered: number;
  /**
   * Answers with a 5xx status, including those the client never saw (lost, duplicate, or late):
   * the server failed on something the network did.
   */
  serverErrors: number;
}

/** One client's connection to the server, with its own fault stream. */
export interface SimulatedLink {
  readonly name: string;
  /** A `fetch` for the client's code: relative paths go to the network's server. */
  readonly fetch: typeof fetch;
  /** An offline link refuses every request at once, as a device without internet. */
  offline: boolean;
  faults: FaultRates;
  readonly stats: Readonly<LinkStats>;
}

export interface DeliverLateOptions {
  /** The chance that each held request is delivered now; the rest stay held. Default 1. */
  readonly fraction?: number;
}

export interface SimulatedNetwork {
  link(name: string, faults?: FaultRates): SimulatedLink;
  /**
   * Delivers held (delayed) requests to the server, one after another in a random order;
   * their answers are lost, as the client stopped waiting. Returns how many were delivered.
   */
  deliverLate(options?: DeliverLateOptions): Promise<number>;
  /** Requests still held. */
  readonly held: number;
  /** Every link online, without faults, from now on. Held requests stay held. */
  heal(): void;
  /** Each link's counters, and their sum under `total`. */
  stats(): Record<string, Readonly<LinkStats>>;
}

export interface SimulatedNetworkOptions {
  /** Where relative request paths go, e.g. `http://127.0.0.1:49152`. */
  readonly baseUrl: string;
  /** Decides each link's faults (one fork per link) and the order of late deliveries. */
  readonly random: SimRandom;
  /** The real transport; the platform `fetch` by default. */
  readonly fetch?: typeof fetch;
}

/** What real `fetch` throws when there is no answer; `apiRequest` reads it as unreachable. */
class NetworkFault extends TypeError {
  override name = "NetworkFault";
}

interface HeldRequest {
  readonly link: string;
  send(): Promise<Response>;
}

type Fate = keyof FaultRates | "deliver";

function newStats(): LinkStats {
  return {
    requests: 0,
    answered: 0,
    offline: 0,
    droppedRequests: 0,
    droppedResponses: 0,
    duplicated: 0,
    delayed: 0,
    lateDelivered: 0,
    serverErrors: 0,
  };
}

function checkRates(faults: FaultRates): FaultRates {
  const rates = [faults.dropRequest, faults.dropResponse, faults.duplicate, faults.delay];
  const sum = rates.reduce((a, b) => a + b, 0);
  if (rates.some((rate) => !(rate >= 0)) || sum > 1) {
    throw new RangeError("Fault rates are from 0 to 1 and add up to at most 1");
  }
  return faults;
}

/** Reads and discards an answer nobody will see, so its connection is released. */
async function discard(response: Response): Promise<void> {
  await response.arrayBuffer().catch(() => undefined);
}

/**
 * A network between simulated clients and a real server (ADR-0026). Each request's fate is
 * drawn from its link's own stream, so a device's faults depend only on the seed and on what
 * that device sent, not on how the devices interleave.
 */
export function createSimulatedNetwork(options: SimulatedNetworkOptions): SimulatedNetwork {
  const transport = options.fetch ?? fetch;
  const lateRandom = options.random.fork("late");
  const links = new Map<string, SimulatedLink & { stats: LinkStats }>();
  let heldRequests: HeldRequest[] = [];

  function link(name: string, faults: FaultRates = NO_FAULTS): SimulatedLink {
    if (links.has(name) || name === "total") throw new Error(`A link cannot be named ${name}`);
    const random = options.random.fork(`link:${name}`);
    const stats = newStats();
    const state = { offline: false, faults: checkRates(faults) };

    function fate(): Fate {
      // One draw per request, whatever the rates, so changing a rate keeps the stream aligned.
      const draw = random.int(0, 999_999) / 1_000_000;
      let edge = 0;
      for (const kind of ["dropRequest", "dropResponse", "duplicate", "delay"] as const) {
        edge += state.faults[kind];
        if (draw < edge) return kind;
      }
      return "deliver";
    }

    const simulatedFetch = async (
      input: Parameters<typeof fetch>[0],
      init?: RequestInit,
    ): Promise<Response> => {
      if (typeof input !== "string" && !(input instanceof URL)) {
        throw new TypeError("The simulated network takes a path or a URL, not a Request");
      }
      if (init?.body !== undefined && init.body !== null && typeof init.body !== "string") {
        throw new TypeError("The simulated network sends text bodies only");
      }
      const url = new URL(input, options.baseUrl);
      const request: RequestInit = {
        method: init?.method ?? "GET",
        ...(init?.headers === undefined ? {} : { headers: init.headers }),
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
      };
      const send = async () => {
        const response = await transport(url, request);
        if (response.status >= 500) stats.serverErrors += 1;
        return response;
      };
      stats.requests += 1;
      if (state.offline) {
        stats.offline += 1;
        throw new NetworkFault(`${name}: offline`);
      }
      switch (fate()) {
        case "dropRequest":
          stats.droppedRequests += 1;
          throw new NetworkFault(`${name}: request lost`);
        case "dropResponse": {
          stats.droppedResponses += 1;
          await discard(await send());
          throw new NetworkFault(`${name}: answer lost`);
        }
        case "duplicate": {
          stats.duplicated += 1;
          const answers = await Promise.all([send(), send()]);
          // Whichever copy's answer comes back: the one that lost a race must be a fine answer too.
          const [kept, lost] = random.chance(0.5) ? answers : [answers[1], answers[0]];
          await discard(lost);
          stats.answered += 1;
          return kept;
        }
        case "delay":
          stats.delayed += 1;
          heldRequests.push({ link: name, send });
          throw new NetworkFault(`${name}: timed out`);
        case "deliver": {
          const response = await send();
          stats.answered += 1;
          return response;
        }
      }
    };

    const created = {
      name,
      fetch: simulatedFetch,
      get offline() {
        return state.offline;
      },
      set offline(value: boolean) {
        state.offline = value;
      },
      get faults() {
        return state.faults;
      },
      set faults(value: FaultRates) {
        state.faults = checkRates(value);
      },
      stats,
    };
    links.set(name, created);
    return created;
  }

  return {
    link,
    async deliverLate({ fraction = 1 } = {}) {
      const now: HeldRequest[] = [];
      const later: HeldRequest[] = [];
      for (const held of heldRequests) (lateRandom.chance(fraction) ? now : later).push(held);
      heldRequests = later;
      for (const held of lateRandom.shuffle(now)) {
        await discard(await held.send());
        const stats = links.get(held.link)?.stats;
        if (stats !== undefined) stats.lateDelivered += 1;
      }
      return now.length;
    },
    get held() {
      return heldRequests.length;
    },
    heal() {
      for (const each of links.values()) {
        each.offline = false;
        each.faults = NO_FAULTS;
      }
    },
    stats() {
      const total = newStats();
      const out: Record<string, Readonly<LinkStats>> = {};
      for (const [name, each] of links) {
        out[name] = { ...each.stats };
        for (const key of Object.keys(total) as (keyof LinkStats)[]) {
          total[key] += each.stats[key];
        }
      }
      out["total"] = total;
      return out;
    },
  };
}
