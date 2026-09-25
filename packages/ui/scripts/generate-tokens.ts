/**
 * Writes the token stylesheet and the Tailwind theme (committed; a test keeps them equal to the
 * generator's output). Run with `pnpm --filter @mustawfi/ui tokens:generate`; the component
 * gallery (`/gallery` in the web app) shows the result.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateTailwindThemeCss, generateTokenCss } from "../src/tokens/css.ts";
import { generatePalette } from "../src/tokens/palette.ts";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = generatePalette();

writeFileSync(join(packageDir, "src/styles/tokens.css"), generateTokenCss(palette));
writeFileSync(join(packageDir, "src/styles/theme.css"), generateTailwindThemeCss());

console.log("Wrote src/styles/tokens.css and src/styles/theme.css");
