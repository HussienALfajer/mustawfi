import { describe, expect, it } from "vitest";
import { createSimulatedNetwork, type FaultRates, NO_FAULTS } from "./network.ts";
import { simRandom } from "./random.ts";

/** A server double that counts what reaches it. */
function fakeServer() {
  const received: string[] = [];
  const transport: typeof fetch = (input, init) => {
    const url = input instanceof URL ? input.href : typeof input === "string" ? input : input.url;
    const body = typeof init?.body === "string" ? init.body : "";
    received.push(`${init?.method ?? "GET"} ${url} ${body}`);
    return Promise.resolve(new Response(JSON.stringify({ n: received.length }), { status: 200 }));
  };
  return { received, transport };
}

function network(seed = 7) {
  const server = fakeServer();
  const net = createSimulatedNetwork({
    baseUrl: "http://sim.test",
    random: simRandom(seed),
    fetch: server.transport,
  });
  return { server, net };
}

const only = (kind: keyof FaultRates): FaultRates => ({ ...NO_FAULTS, [kind]: 1 });
const post = (body: string): RequestInit => ({ method: "POST", body });

describe("the simulated network", () => {
  it("delivers relative paths to the server and returns its answer", async () => {
    const { server, net } = network();
    const link = net.link("K7");
    const response = await link.fetch("/api/v1/sync/push", post("a"));
    expect(await response.json()).toEqual({ n: 1 });
    expect(server.received).toEqual(["POST http://sim.test/api/v1/sync/push a"]);
    expect(link.stats).toMatchObject({ requests: 1, answered: 1 });
  });

  it("loses a dropped request before the server sees it", async () => {
    const { server, net } = network();
    const link = net.link("K7", only("dropRequest"));
    await expect(link.fetch("/x", post("a"))).rejects.toThrow(TypeError);
    expect(server.received).toEqual([]);
    expect(link.stats).toMatchObject({ droppedRequests: 1, answered: 0 });
  });

  it("loses a dropped answer after the server handled the request", async () => {
    const { server, net } = network();
    const link = net.link("K7", only("dropResponse"));
    await expect(link.fetch("/x", post("a"))).rejects.toThrow(TypeError);
    expect(server.received).toHaveLength(1);
    expect(link.stats).toMatchObject({ droppedResponses: 1, answered: 0 });
  });

  it("delivers a duplicated request twice and answers once", async () => {
    const { server, net } = network();
    const link = net.link("K7", only("duplicate"));
    await expect(link.fetch("/x", post("a"))).resolves.toBeInstanceOf(Response);
    expect(server.received).toEqual(["POST http://sim.test/x a", "POST http://sim.test/x a"]);
    expect(link.stats).toMatchObject({ duplicated: 1, answered: 1 });
  });

  it("answers a duplicated request with either copy's answer", async () => {
    const { net } = network();
    const link = net.link("K7", only("duplicate"));
    const kept = new Set<string>();
    for (let i = 0; i < 20; i += 1) {
      const { n } = (await (await link.fetch("/x")).json()) as { n: number };
      kept.add(n % 2 === 1 ? "first" : "second");
    }
    expect(kept).toEqual(new Set(["first", "second"]));
  });

  it("counts 5xx answers, also those the client never sees", async () => {
    const failing = (() => Promise.resolve(new Response("{}", { status: 500 }))) as typeof fetch;
    const net = createSimulatedNetwork({
      baseUrl: "http://sim.test",
      random: simRandom(1),
      fetch: failing,
    });
    const link = net.link("K7", only("dropResponse"));
    await expect(link.fetch("/x")).rejects.toThrow(TypeError);
    link.faults = only("duplicate");
    await link.fetch("/x");
    link.faults = only("delay");
    await expect(link.fetch("/x")).rejects.toThrow(TypeError);
    await net.deliverLate();
    expect(link.stats.serverErrors).toBe(4);
  });

  it("holds a delayed request and delivers it later, after newer ones", async () => {
    const { server, net } = network();
    const link = net.link("K7", only("delay"));
    await expect(link.fetch("/x", post("old"))).rejects.toThrow(TypeError);
    expect(server.received).toEqual([]);
    link.faults = NO_FAULTS;
    await link.fetch("/x", post("new"));
    expect(net.held).toBe(1);
    expect(await net.deliverLate()).toBe(1);
    expect(server.received).toEqual(["POST http://sim.test/x new", "POST http://sim.test/x old"]);
    expect(net.held).toBe(0);
    expect(link.stats).toMatchObject({ delayed: 1, lateDelivered: 1, answered: 1 });
  });

  it("delivers only some held requests when asked for a fraction", async () => {
    const { server, net } = network(11);
    const link = net.link("K7", only("delay"));
    for (let i = 0; i < 40; i += 1) await link.fetch("/x", post(String(i))).catch(() => undefined);
    const delivered = await net.deliverLate({ fraction: 0.5 });
    expect(delivered).toBeGreaterThan(5);
    expect(delivered).toBeLessThan(35);
    expect(net.held).toBe(40 - delivered);
    expect(server.received).toHaveLength(delivered);
    // Out of order: the held requests arrive shuffled.
    const bodies = server.received.map((line) => Number.parseInt(line.split(" ")[2] ?? "", 10));
    expect(bodies).not.toEqual([...bodies].sort((a, b) => a - b));
  });

  it("refuses every request of an offline link, until it is healed", async () => {
    const { server, net } = network();
    const link = net.link("K7", only("dropRequest"));
    link.offline = true;
    await expect(link.fetch("/x")).rejects.toThrow(TypeError);
    expect(link.stats).toMatchObject({ offline: 1, droppedRequests: 0 });
    net.heal();
    expect(link.offline).toBe(false);
    await link.fetch("/x");
    expect(server.received).toHaveLength(1);
  });

  it("draws each link's faults from its own stream: the same seed gives the same fates", async () => {
    const faults: FaultRates = { dropRequest: 0.2, dropResponse: 0.2, duplicate: 0.2, delay: 0.2 };
    async function fates(seed: number, noiseOnOtherLink: boolean) {
      const { net } = network(seed);
      const a = net.link("A", faults);
      const b = net.link("B", faults);
      const out: string[] = [];
      for (let i = 0; i < 30; i += 1) {
        if (noiseOnOtherLink) await b.fetch("/x").catch(() => undefined);
        out.push(
          await a.fetch("/x").then(
            () => "ok",
            () => "fault",
          ),
        );
      }
      return { out, stats: { ...a.stats } };
    }
    const first = await fates(3, false);
    expect(await fates(3, true)).toEqual(first);
    expect((await fates(4, false)).out).not.toEqual(first.out);
  });

  it("refuses fault rates above 1 in all and a link named twice", () => {
    const { net } = network();
    expect(() => net.link("A", { ...NO_FAULTS, delay: 0.6, duplicate: 0.6 })).toThrow(RangeError);
    net.link("B");
    expect(() => net.link("B")).toThrow();
    expect(() => net.link("total")).toThrow();
  });

  it("sums the links' counters", async () => {
    const { net } = network();
    await net.link("A").fetch("/x");
    await net
      .link("B", only("dropRequest"))
      .fetch("/x")
      .catch(() => undefined);
    expect(net.stats()["total"]).toMatchObject({ requests: 2, answered: 1, droppedRequests: 1 });
  });
});

describe("the simulation's randomness", () => {
  it("repeats for a seed and differs across seeds and forks", () => {
    const draw = (seed: number, label?: string) => {
      const base = simRandom(seed);
      const random = label === undefined ? base : base.fork(label);
      return Array.from({ length: 20 }, () => random.int(0, 1000));
    };
    expect(draw(1)).toEqual(draw(1));
    expect(draw(1)).not.toEqual(draw(2));
    expect(draw(1, "a")).toEqual(draw(1, "a"));
    expect(draw(1, "a")).not.toEqual(draw(1, "b"));
  });

  it("stays within bounds and reaches both ends", () => {
    const random = simRandom(5);
    const values = new Set(Array.from({ length: 500 }, () => random.int(-2, 2)));
    expect([...values].sort((a, b) => a - b)).toEqual([-2, -1, 0, 1, 2]);
    expect(Array.from({ length: 100 }, () => random.chance(0)).some(Boolean)).toBe(false);
    expect(Array.from({ length: 100 }, () => random.chance(1)).every(Boolean)).toBe(true);
    expect(random.shuffle([1, 2, 3, 4]).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(() => random.pick([])).toThrow(RangeError);
    expect(() => simRandom(-1)).toThrow(RangeError);
  });
});
