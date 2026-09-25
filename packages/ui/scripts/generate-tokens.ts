/**
 * Writes the token stylesheet (committed; a test keeps it equal to the generator's output) and
 * the preview page (not committed). Run with `pnpm --filter @mustawfi/ui tokens:generate`.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generatePreviewHtml } from "../src/preview/preview.ts";
import { generateTokenCss } from "../src/tokens/css.ts";
import { generatePalette } from "../src/tokens/palette.ts";

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const palette = generatePalette();

writeFileSync(join(packageDir, "src/styles/tokens.css"), generateTokenCss(palette));

const fonts = [
  ...[400, 500, 600, 700].map((weight) => `ibm-plex-sans-arabic/${weight}.css`),
  ...[400, 600].map((weight) => `ibm-plex-sans/${weight}.css`),
  "ibm-plex-mono/400.css",
].map((file) => `../node_modules/@fontsource/${file}`);
mkdirSync(join(packageDir, "preview"), { recursive: true });
writeFileSync(
  join(packageDir, "preview/index.html"),
  generatePreviewHtml({ palette, fontStylesheets: fonts }),
);

console.log("Wrote src/styles/tokens.css and preview/index.html");

// A hosted copy for review outside the repository: fonts from Google Fonts, no document shell.
if (process.argv.includes("--hosted")) {
  const hostedFonts = [
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;600&display=swap",
  ];
  writeFileSync(
    join(packageDir, "preview/hosted.html"),
    generatePreviewHtml({ palette, fontStylesheets: hostedFonts, hosted: true }),
  );
  console.log("Wrote preview/hosted.html");
}
