import { describe, expect, it } from "vitest";
import { receiptCommands } from "./receipt-commands.ts";

describe("receiptCommands", () => {
  const drawerOn = { cut: true, openDrawer: true };

  it("opens the drawer on the first print the sale offers", () => {
    expect(receiptCommands(drawerOn, { justSold: true, drawerAlreadyOpened: false })).toEqual({
      cut: true,
      openDrawer: true,
    });
  });

  it("never opens it on a reprint of the same sale's receipt", () => {
    expect(
      receiptCommands(drawerOn, { justSold: true, drawerAlreadyOpened: true }).openDrawer,
    ).toBe(false);
  });

  it("never opens it for an earlier invoice", () => {
    expect(
      receiptCommands(drawerOn, { justSold: false, drawerAlreadyOpened: false }).openDrawer,
    ).toBe(false);
  });

  it("never opens it when the setting is off", () => {
    expect(
      receiptCommands(
        { cut: false, openDrawer: false },
        { justSold: true, drawerAlreadyOpened: false },
      ),
    ).toEqual({ cut: false, openDrawer: false });
  });
});
