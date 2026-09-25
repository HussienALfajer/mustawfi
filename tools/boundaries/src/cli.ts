import { resolve } from "node:path";
import { checkBoundaries, discoverPackages } from "./check.ts";

const rootDir = resolve(import.meta.dirname, "../../..");
const violations = await checkBoundaries(rootDir);

for (const v of violations) {
  console.error(`✖ ${v.rule}: ${v.from} → ${v.to}\n    ${v.message}`);
}
const packageCount = discoverPackages(rootDir).length;
if (violations.length > 0) {
  console.error(`\n${violations.length} boundary violation(s) in ${packageCount} packages.`);
  process.exitCode = 1;
} else {
  console.log(`Boundaries hold: ${packageCount} packages checked, 0 violations.`);
}
