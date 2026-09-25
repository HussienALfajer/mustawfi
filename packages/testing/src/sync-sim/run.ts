import type { SimulatedNetwork } from "./network.ts";
import type { SimRandom } from "./random.ts";

/** Something that can happen in a step of the run; picked in proportion to its weight. */
export interface SimAction {
  readonly name: string;
  readonly weight: number;
  /** Does it, and says what happened for the trace (`K7 sold K7-INV-000004`). */
  run(random: SimRandom): Promise<string>;
}

export interface SimulationOptions {
  readonly random: SimRandom;
  readonly steps: number;
  readonly actions: readonly SimAction[];
  /** Runs before each step, e.g. to move the clocks on. */
  readonly beforeStep?: (random: SimRandom) => void;
}

/** A run stopped on an error; the message names the seed and the steps that led there. */
export class SimulationFailed extends Error {
  override name = "SimulationFailed";
  readonly seed: number;
  readonly trace: readonly string[];

  constructor(seed: number, trace: readonly string[], cause: unknown) {
    const tail = trace.slice(-15).join("\n  ");
    super(`sync simulation failed (seed ${String(seed)}), last steps:\n  ${tail}`, { cause });
    this.seed = seed;
    this.trace = trace;
  }
}

/**
 * Runs `steps` steps, each one action picked by weight from the seed (ADR-0026). Returns the
 * trace, one line per step.
 */
export async function runSimulation(options: SimulationOptions): Promise<string[]> {
  const { random, actions } = options;
  const totalWeight = actions.reduce((sum, action) => sum + action.weight, 0);
  if (actions.some((action) => !Number.isSafeInteger(action.weight) || action.weight < 0)) {
    throw new RangeError("Action weights are whole numbers from 0");
  }
  if (totalWeight === 0) throw new RangeError("At least one action has a weight");
  const choose = random.fork("actions");
  const trace: string[] = [];
  for (let step = 1; step <= options.steps; step += 1) {
    options.beforeStep?.(random);
    let point = choose.int(0, totalWeight - 1);
    const action = actions.find((candidate) => (point -= candidate.weight) < 0);
    if (action === undefined) throw new Error("no action picked");
    try {
      trace.push(
        `${String(step)} ${action.name}: ${await action.run(random.fork(`step:${String(step)}`))}`,
      );
    } catch (error) {
      trace.push(`${String(step)} ${action.name}: threw`);
      throw new SimulationFailed(random.seed, trace, error);
    }
  }
  return trace;
}

/** A simulated device as convergence sees it. */
export interface ConvergingDevice {
  readonly name: string;
  /** One sync round; never throws. */
  sync(): Promise<void>;
  /** Operations still waiting for the server. */
  pending(): Promise<number>;
}

export interface ConvergeOptions {
  readonly network: SimulatedNetwork;
  readonly devices: readonly ConvergingDevice[];
  /** Rounds per device at most before giving up. Default 20. */
  readonly maxRounds?: number;
}

/**
 * Ends the outage: heals the network, lets every held request arrive, then syncs each device
 * until no operation waits, and once more so each pulls what the others' rounds wrote. Throws
 * when the devices do not settle within `maxRounds`. Returns the rounds it took.
 */
export async function converge(options: ConvergeOptions): Promise<number> {
  const { network, devices } = options;
  const maxRounds = options.maxRounds ?? 20;
  network.heal();
  await network.deliverLate();
  for (let round = 1; round <= maxRounds; round += 1) {
    for (const device of devices) await device.sync();
    const pending = await Promise.all(devices.map((device) => device.pending()));
    if (pending.every((count) => count === 0)) {
      for (const device of devices) await device.sync();
      return round;
    }
  }
  const left = await Promise.all(
    devices.map(async (device) => `${device.name}: ${String(await device.pending())}`),
  );
  throw new Error(
    `the devices did not converge in ${String(maxRounds)} rounds (${left.join(", ")})`,
  );
}
