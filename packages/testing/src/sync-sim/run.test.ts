import { describe, expect, it } from "vitest";
import { createSimulatedNetwork, NO_FAULTS } from "./network.ts";
import { simRandom } from "./random.ts";
import { converge, runSimulation, type SimAction, SimulationFailed } from "./run.ts";

const actions: SimAction[] = [
  { name: "a", weight: 3, run: (random) => Promise.resolve(`a${String(random.int(0, 9))}`) },
  { name: "b", weight: 1, run: () => Promise.resolve("b") },
  { name: "never", weight: 0, run: () => Promise.reject(new Error("weight 0 ran")) },
];

describe("runSimulation", () => {
  it("replays the same steps for the same seed, picking by weight", async () => {
    const run = async (seed: number) =>
      runSimulation({ random: simRandom(seed), steps: 200, actions });
    const first = await run(9);
    expect(first).toHaveLength(200);
    expect(await run(9)).toEqual(first);
    expect(await run(10)).not.toEqual(first);
    const picked = first.filter((line) => line.includes(" a: ")).length;
    expect(picked).toBeGreaterThan(120);
    expect(picked).toBeLessThan(180);
  });

  it("stops on a failing step and names the seed and the steps that led there", async () => {
    const failing: SimAction = {
      name: "boom",
      weight: 1,
      run: () => Promise.reject(new Error("bad")),
    };
    const error = await runSimulation({ random: simRandom(4), steps: 5, actions: [failing] }).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(SimulationFailed);
    expect((error as SimulationFailed).message).toMatch(/seed 4/);
    expect((error as SimulationFailed).trace).toEqual(["1 boom: threw"]);
  });
});

describe("converge", () => {
  const network = () =>
    createSimulatedNetwork({
      baseUrl: "http://sim.test",
      random: simRandom(1),
      fetch: () => Promise.resolve(new Response("{}")),
    });

  it("heals the network, then syncs until nothing is pending, and once more", async () => {
    const net = network();
    const link = net.link("A", { ...NO_FAULTS, dropRequest: 1 });
    link.offline = true;
    let pending = 3;
    let syncs = 0;
    const rounds = await converge({
      network: net,
      devices: [
        {
          name: "A",
          sync: () => {
            syncs += 1;
            pending = Math.max(0, pending - 1);
            return Promise.resolve();
          },
          pending: () => Promise.resolve(pending),
        },
      ],
    });
    expect(rounds).toBe(3);
    expect(syncs).toBe(4);
    expect(link.offline).toBe(false);
    expect(link.faults).toEqual(NO_FAULTS);
  });

  it("gives up when a device never settles", async () => {
    await expect(
      converge({
        network: network(),
        maxRounds: 3,
        devices: [{ name: "A", sync: () => Promise.resolve(), pending: () => Promise.resolve(1) }],
      }),
    ).rejects.toThrow(/did not converge in 3 rounds \(A: 1\)/);
  });
});
