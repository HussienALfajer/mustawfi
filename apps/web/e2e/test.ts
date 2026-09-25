import { AxeBuilder } from "@axe-core/playwright";
import { test as base, expect, type Page } from "@playwright/test";

/** The WCAG 2.1 A and AA rules: what `design-system.md` holds every screen to. */
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Fails on any axe violation in the page as it is now, listing each rule with the elements
 * that break it (`screen-patterns.md`: an axe check in every journey fails the build).
 */
export async function expectAccessible(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(WCAG_TAGS)
    // React Aria's off-screen live region: a Button that stops being pending announces itself
    // there by id, and the node stays 7 s after the button is gone (a page change), naming nothing.
    .exclude("[data-live-announcer]")
    .analyze();
  const violations = results.violations.map(
    (violation) =>
      `${violation.id} (${violation.help}): ${violation.nodes.map((node) => `${node.target.join(" ")} ${node.html.slice(0, 160)}`).join(" | ")}`,
  );
  expect(violations, "axe violations").toEqual([]);
}

/**
 * Every journey imports `test` from here: after a passing journey, axe checks the screen it
 * ended on, so no journey goes without the check. Journeys also call `expectAccessible` on each
 * screen they pass through.
 */
export const test = base.extend<{ axeAfterEach: undefined }>({
  axeAfterEach: [
    async ({ page }, use, testInfo) => {
      await use(undefined);
      if (testInfo.status === testInfo.expectedStatus && !page.isClosed()) {
        await expectAccessible(page);
      }
    },
    { auto: true },
  ],
});

export { expect };
