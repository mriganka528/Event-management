import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Theme-switch regression guard.
 *
 * Dark mode is implemented by remapping the legacy Tailwind palette classes onto
 * the semantic tokens in `globals.css`. Two ways that silently rots:
 *
 *  1. A rule that matches an exact class token cannot ever match a *variant* of
 *     that token. `[class~="bg-stone-100"]` does not match `hover:bg-stone-100`,
 *     because the class token is `hover:bg-stone-100`. Every hover and focus
 *     colour therefore kept its light value, which is what made buttons flash a
 *     white block under the pointer on a dark page.
 *  2. A variant of a *themed* colour that has no rule is the visible half of the
 *     bug; this test fails on it directly.
 */

const ROOTS = ["app", "components", "lib"];
const files: string[] = [];
function walk(target: string) {
  if (!existsSync(target)) return;
  if (statSync(target).isFile()) {
    files.push(target);
    return;
  }
  for (const entry of readdirSync(target)) walk(join(target, entry));
}
for (const root of ROOTS) walk(root);

const css = readFileSync("app/globals.css", "utf8");

/** Utilities remapped by an exact `[class~="..."]` selector. */
const exact = new Set<string>();
/** Utilities remapped by the variant-aware `[class*="..."]` selector. */
const variant = new Set<string>();
for (const m of css.matchAll(/\[class~="([^"]+)"\]/g)) exact.add(m[1]);
for (const m of css.matchAll(/\[class\*="([^"]+)"\]/g)) variant.add(m[1]);

function isCovered(token: string): boolean {
  if (exact.has(token)) return true;
  const colon = token.indexOf(":");
  return colon !== -1 && variant.has(`:${token.slice(colon + 1)}`);
}

const PALETTES = new Set([
  "white", "slate", "gray", "zinc", "neutral", "stone", "red", "orange", "amber",
  "yellow", "lime", "green", "emerald", "teal", "cyan", "sky", "blue", "indigo",
  "violet", "purple", "fuchsia", "pink", "rose",
]);
const PAINTERS = new Set([
  "bg", "text", "border", "ring", "from", "via", "to", "divide", "outline",
  "decoration", "shadow", "accent", "caret", "fill", "stroke",
]);

/** Splits `hover:bg-stone-100/50` into its variant, painter, palette and steps. */
function parse(token: string) {
  const colon = token.indexOf(":");
  const hasVariant = colon !== -1;
  const rest = hasVariant ? token.slice(colon + 1) : token;
  const dash = rest.indexOf("-");
  if (dash === -1) return null;
  const painter = rest.slice(0, dash);
  if (!PAINTERS.has(painter)) return null;
  const colour = rest.slice(dash + 1);
  const m = colour.match(/^([a-z]+)(?:-(\d{2,3}))?(?:\/([\d.]+))?$/);
  if (!m) return null;
  return { hasVariant, painter, palette: m[1], shade: m[2] ?? null, opacity: m[3] ?? null };
}

/** Every colour utility the app actually uses, across cva variants too. */
function usedColourUtilities(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>();
  for (const file of files) {
    if (!/\.tsx?$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    // Any quoted string that looks like a utility list. Reading only
    // `className="..."` misses every cva variant, which is where the button
    // styles live.
    for (const m of source.matchAll(/["'`]([^"'`\n]*(?:bg-|text-|border-|ring-|from-|to-|via-|divide-|shadow-)[^"'`\n]*)["'`]/g)) {
      for (const token of m[1].split(/\s+/)) {
        if (!token) continue;
        const p = parse(token);
        if (!p || !PALETTES.has(p.palette)) continue;
        if (p.palette === "white" && p.painter !== "bg") continue; // white text on dark heroes is intentional
        if (!found.has(token)) found.set(token, new Set());
        found.get(token)!.add(file);
      }
    }
  }
  return found;
}

test("every variant of a themed colour is themed too", () => {
  const leaks: string[] = [];
  for (const token of usedColourUtilities().keys()) {
    const p = parse(token);
    if (!p?.hasVariant) continue;
    if (isCovered(token)) continue;

    // Only a problem when the bare utility IS themed: that means the author
    // intended the colour to follow the theme and only the hover escaped.
    const bare = `${p.painter}-${p.palette}${p.shade ? `-${p.shade}` : ""}`;
    const bareThemed = isCovered(bare) || (p.opacity ? isCovered(`${bare}/${p.opacity}`) : false);
    if (bareThemed) leaks.push(`${token} (${bare} is themed but the variant is not)`);
  }
  assert.deepEqual(leaks, [], `these variants keep their light colour in dark mode:\n  ${leaks.join("\n  ")}`);
});

test("the shim is variant aware", () => {
  // The specific regression: an exact-token-only shim cannot reach a hover.
  assert.ok(variant.size > 0, "globals.css must remap variant-prefixed utilities with a [class*=] selector");
  // ...and it must not degrade into a bare substring match, which would capture
  // `bg-stone-500` when the rule meant `bg-stone-50`.
  for (const selector of variant) {
    assert.ok(selector.startsWith(":"), `a [class*=] selector must be anchored with ":" so it cannot over-match, found "${selector}"`);
  }
});

test("the hover states that were visibly broken are covered", () => {
  // `hover:bg-stone-100` is the ghost button used on the staff sign-in page, and
  // `hover:text-amber-800` was dark amber text on a dark surface.
  for (const token of ["hover:bg-stone-100", "hover:bg-stone-50", "hover:text-amber-800"]) {
    assert.ok(isCovered(token), `${token} must follow the theme`);
  }
});

test("clerk's own UI is wired to the theme", () => {
  // The provider renders the customer sign-in and email verification. Left
  // alone it paints a light-only card inside a themed page.
  const theme = readFileSync("lib/clerk-theme.ts", "utf8");
  assert.match(theme, /colorBackground:\s*"var\(--clerk-surface\)"/, "clerk's surface must come from the theme tokens");
  assert.match(theme, /colorForeground:\s*"var\(--clerk-ink\)"/, "clerk's ink must come from the theme tokens");

  // The provider is mounted only around the customer auth screens. It used to
  // wrap every route, which shipped Clerk's script to the admin and marketing
  // pages as well; the appearance still has to reach it wherever it is mounted.
  const layout = readFileSync("app/(customer-auth)/customer/auth/layout.tsx", "utf8");
  assert.match(layout, /ClerkProvider appearance=\{clerkAppearance\}/, "the appearance must be applied at the provider");
  assert.doesNotMatch(readFileSync("app/layout.tsx", "utf8"), /ClerkProvider/, "the root layout must not ship Clerk to every page");

  // The aliases must resolve against tokens that themselves switch with the theme.
  assert.match(css, /--clerk-surface:\s*var\(--card\)/, "clerk aliases must point at the application tokens");
  assert.match(css, /\.cl-card/, "the provider card needs themed overrides");

  // Guard against hiding the social row: the customer Google sign-in lives there.
  assert.doesNotMatch(
    css,
    /\.cl-socialButtonsBlock\s*\{[^}]*display:\s*none/,
    "the social sign-in row must stay visible",
  );
});

test("the theme defines the same tokens in both modes", () => {
  // A token only in one mode silently falls back to nothing, which reads as a
  // random unstyled element rather than a theme bug.
  const lightBlock = css.slice(css.indexOf(":root {"), css.indexOf(':root[data-theme="dark"]'));
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"] {'), css.indexOf("@theme inline"));
  const names = (block: string) => new Set([...block.matchAll(/^\s{2}(--[\w-]+):/gm)].map((m) => m[1]));
  const light = names(lightBlock);
  const dark = names(darkBlock);
  const missingInDark = [...light].filter((n) => !dark.has(n));
  assert.deepEqual(missingInDark, [], `dark mode does not redefine: ${missingInDark.join(", ")}`);
});