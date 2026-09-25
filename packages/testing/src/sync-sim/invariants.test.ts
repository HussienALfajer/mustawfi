import { Decimal } from "@mustawfi/kernel";
import { describe, expect, it } from "vitest";
import {
  convergenceProblems,
  type ConvergenceInput,
  type DeviceSnapshot,
  type ServerSnapshot,
} from "./invariants.ts";

const P1 = "product-1";
const P2 = "product-2";

/** Two devices, three sales, all delivered: a converged run. */
function converged(): ConvergenceInput {
  const devices: DeviceSnapshot[] = [
    {
      name: "K7",
      deviceId: "device-k7",
      prefix: "K7",
      invoices: [
        {
          id: "i1",
          number: "K7-INV-000001",
          total: "100.5",
          syncState: "accepted",
          rejectionCode: null,
        },
        {
          id: "i2",
          number: "K7-INV-000002",
          total: "20",
          syncState: "duplicate",
          rejectionCode: null,
        },
      ],
      productIds: [P1, P2],
    },
    {
      name: "M3",
      deviceId: "device-m3",
      prefix: "M3",
      invoices: [
        {
          id: "i3",
          number: "M3-INV-000001",
          total: "0",
          syncState: "accepted",
          rejectionCode: null,
        },
      ],
      productIds: [P2, P1],
    },
  ];
  const server: ServerSnapshot = {
    invoices: [
      {
        id: "i1",
        number: "K7-INV-000001",
        deviceId: "device-k7",
        total: "100.5000",
        lines: [{ productId: P1, quantity: "2" }],
      },
      {
        id: "i2",
        number: "K7-INV-000002",
        deviceId: "device-k7",
        total: "20.0000",
        lines: [{ productId: P2, quantity: "1" }],
      },
      {
        id: "i3",
        number: "M3-INV-000001",
        deviceId: "device-m3",
        total: "0.0000",
        lines: [{ productId: P2, quantity: "3" }],
      },
    ],
    entries: [
      { id: "e1", sourceId: "i1", debit: "100.5000", credit: "100.5000" },
      { id: "e2", sourceId: "i2", debit: "20", credit: "20" },
    ],
    productIds: [P1, P2],
    stock: [
      { productId: P1, onHand: "3" },
      { productId: P2, onHand: "-4" },
    ],
  };
  return { devices, server, received: new Map([[P1, Decimal.of("5")]]) };
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] extends readonly (infer U)[] ? U[] : T[K] };

/** A converged run changed by `change`, to prove each check fires. */
function broken(
  change: (input: {
    devices: Mutable<DeviceSnapshot>[];
    server: Mutable<ServerSnapshot>;
    received: Map<string, Decimal>;
  }) => void,
): string[] {
  const input = structuredClone({ ...converged(), received: new Map() }) as unknown as {
    devices: Mutable<DeviceSnapshot>[];
    server: Mutable<ServerSnapshot>;
    received: Map<string, Decimal>;
  };
  input.received = new Map([[P1, Decimal.of("5")]]);
  change(input);
  return convergenceProblems(input);
}

describe("convergence checks", () => {
  it("find nothing wrong in a converged run", () => {
    expect(convergenceProblems(converged())).toEqual([]);
  });

  it("report a sale the server lost", () => {
    expect(broken(({ server }) => server.invoices.splice(1, 1)).join("\n")).toMatch(
      /K7 K7-INV-000002 is lost/,
    );
  });

  it("report an invoice on the server twice, or one no device made", () => {
    expect(
      broken(({ server }) => {
        server.invoices.push({ ...server.invoices[0]!, lines: [] });
      }).join("\n"),
    ).toMatch(/invoice i1 is on the server more than once/);
    expect(
      broken(({ server }) => {
        server.invoices.push({
          id: "i9",
          number: "Z9-INV-000001",
          deviceId: "d",
          total: "0",
          lines: [],
        });
      }).join("\n"),
    ).toMatch(/Z9-INV-000001 on the server was never made/);
  });

  it("report a pending or rejected operation", () => {
    const problems = broken(({ devices }) => {
      devices[0]!.invoices[0] = { ...devices[0]!.invoices[0]!, syncState: "pending" };
      devices[1]!.invoices[0] = {
        ...devices[1]!.invoices[0]!,
        syncState: "rejected",
        rejectionCode: "sales.invoice.duplicate",
      };
    });
    expect(problems).toContain("K7 K7-INV-000001 is pending");
    expect(problems).toContain("M3 M3-INV-000001 was rejected: sales.invoice.duplicate");
  });

  it("report a total or number that differs on the server", () => {
    const problems = broken(({ server }) => {
      server.invoices[0] = { ...server.invoices[0]!, total: "100.4", number: "K7-INV-000009" };
    }).join("\n");
    expect(problems).toMatch(/totals 100.4 on the server/);
    expect(problems).toMatch(/numbered K7-INV-000009 on the server/);
  });

  it("report a gap in a device's numbers", () => {
    expect(
      broken(({ devices, server }) => {
        devices[0]!.invoices[1] = { ...devices[0]!.invoices[1]!, number: "K7-INV-000003" };
        server.invoices[1] = { ...server.invoices[1]!, number: "K7-INV-000003" };
      }),
    ).toContain("K7 numbers are not 1..2 without gaps");
  });

  it("report an unbalanced entry, a missing entry, and an entry for no invoice", () => {
    const problems = broken(({ server }) => {
      server.entries[0] = { ...server.entries[0]!, credit: "100.4" };
      server.entries.splice(1, 1);
      server.entries.push({ id: "e9", sourceId: "nothing", debit: "1", credit: "1" });
    }).join("\n");
    expect(problems).toMatch(/entry e1 is unbalanced/);
    expect(problems).toMatch(/the ledger is unbalanced/);
    expect(problems).toMatch(/K7-INV-000002 has 0 entries, not 1/);
    expect(problems).toMatch(/1 entries post nothing/);
  });

  it("report an entry for a zero-total invoice, or one for the wrong amount", () => {
    const problems = broken(({ server }) => {
      server.entries[0] = { ...server.entries[0]!, debit: "90", credit: "90" };
      server.entries.push({ id: "e3", sourceId: "i3", debit: "1", credit: "1" });
    }).join("\n");
    expect(problems).toMatch(/K7-INV-000001 posts 90, not 100.5/);
    expect(problems).toMatch(/M3-INV-000001 has 1 entries, not 0/);
  });

  it("report stock that is not received minus sold", () => {
    expect(
      broken(({ server }) => {
        server.stock[1] = { productId: P2, onHand: "-3" };
      }),
    ).toContain(`product ${P2} has -3 on hand, not -4`);
    expect(broken(({ received }) => received.set(P2, Decimal.of("1")))).toContain(
      `product ${P2} has -4 on hand, not -3`,
    );
  });

  it("report a device missing a product", () => {
    expect(broken(({ devices }) => devices[1]!.productIds.pop())).toContain(
      "M3 holds 1 products, the server 2",
    );
  });
});
