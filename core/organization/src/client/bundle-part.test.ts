import { describe, expect, it } from "vitest";
import { organizationBundlePart } from "./bundle-part.ts";

const device = {
  deviceId: "01a0d794-1000-7141-9365-dd8a6e877520",
  tenantId: "01a0d794-1000-7141-9365-dd8a6e877521",
};

const shop = {
  id: "01a0d794-1000-7141-9365-dd8a6e8774ee",
  name: "المتجر",
  isDefault: true,
  sortOrder: 0,
  archivedAt: null,
};

/**
 * A device checks its stored bundle again at start-up and before every document (ADR-0021), with
 * the app's current decoders: a bundle signed by an earlier release must still decode after the
 * app is updated, or the device turns read-only until it syncs (QA slice 23).
 */
describe("the organization part in the shapes earlier releases signed", () => {
  it("decodes a part signed before slice 21, whose profile has no print mode", async () => {
    const beforeSlice21 = {
      departments: [shop],
      profile: {
        id: "01a0d794-1000-7141-9365-dd8a6e877510",
        name: "متجر النور",
        address: "دمشق",
        phones: ["+963944123456"],
        taxNumber: null,
        commercialRegister: null,
        logo: null,
        updatedAt: "2026-09-26T08:00:00.000Z",
      },
    };
    const part = await organizationBundlePart.decode(beforeSlice21, device);
    expect(part.profile).toEqual({
      ...beforeSlice21.profile,
      unreadablePhones: [],
      logoPrint: "threshold",
    });
    expect(part.departments).toEqual([shop]);
  });
});
