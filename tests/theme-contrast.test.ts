import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Theme + contrast contract for the access-control and gate screens.
 *
 * These screens are the ones a locked-out or brand-new user sees first, and the
 * original implementation hardcoded a light Tailwind palette, which rendered as
 * a white-on-white block in dark mode. These tests parse the real tokens out of
 * `app/globals.css` and assert that:
 *
 *  1. every theme token the screens depend on exists in BOTH themes,
 *  2. the tinted surfaces reach WCAG AA in both themes,
 *  3. the new screens use the tokens instead of a fixed palette.
 */

const css = readFileSync("app/globals.css", "utf8");

type Theme = Record<string, string>;
type Rgb = [number, number, number];

function parseBlock(selector: string): Theme {
  const start = css.indexOf(selector);
  assert.notEqual(start, -1, `globals.css is missing the "${selector}" block`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const theme: Theme = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const m = line.match(/--([a-z0-9-]+)\s*:\s*(.+?);/i);
    if (m) theme[m[1]] = m[2].trim();
  }
  return theme;
}

const light = parseBlock(":root {");
const dark = parseBlock(':root[data-theme="dark"]');

function toRgb(value: string): Rgb {
  const v = value.trim();
  if (v.startsWith("rgba") || v.startsWith("rgb(")) {
    const n = v.match(/[\d.]+/g)!.map(Number);
    return [n[0], n[1], n[2]];
  }
  assert.ok(v.startsWith("#"), `unsupported colour: ${value}`);
  let h = v.slice(1);
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length === 6) h += "ff";
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function alphaOf(value: string): number {
  if (!value.startsWith("rgba")) return 1;
  const n = value.match(/[\d.]+/g)!.map(Number);
  return n.length >= 4 ? n[3] : 1;
}

/** Flattens a translucent colour onto an opaque backdrop. */
function over(color: string | Rgb, backdrop: string | Rgb): Rgb {
  const [r, g, b] = Array.isArray(color) ? color : toRgb(color);
  const a = Array.isArray(color) ? 1 : alphaOf(color);
  const [br, bg, bb] = Array.isArray(backdrop) ? backdrop : toRgb(backdrop);
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)];
}

function luminance([r, g, b]: Rgb) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(fg: string, bg: string, backdrop: string): number {
  const base = over(bg, backdrop);
  const l1 = luminance(over(fg, base));
  const l2 = luminance(base);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** The tinted panel / chip pair used for each gate tone and status. */
const TINTED_SURFACES = [
  { name: "pending gate", soft: "warning-soft", text: "warning-text" },
  { name: "denied gate", soft: "danger-soft", text: "danger-text" },
  { name: "mfa gate", soft: "info-soft", text: "info-text" },
  { name: "success chip", soft: "success-soft", text: "success-text" },
] as const;

const THEMES = [
  { name: "light", theme: light },
  { name: "dark", theme: dark },
] as const;

test("every token the access-control screens rely on exists in both themes", () => {
  const required = [
    "background", "foreground", "card", "card-elevated", "muted", "muted-strong", "line",
    "brand", "brand-dark", "brand-soft", "surface-muted",
    "success-soft", "success-text", "warning-soft", "warning-text",
    "danger-soft", "danger-text", "info-soft", "info-text",
  ];
  for (const { name, theme } of THEMES) {
    for (const token of required) {
      assert.ok(theme[token], `${name} theme is missing --${token}`);
    }
  }
});

test("the dark theme actually redefines the surface tokens", () => {
  // A copy-pasted light block would still "exist" but render wrong, so require
  // the dark values to differ for the tokens that drive page surfaces.
  for (const token of ["background", "foreground", "card", "muted", "brand-dark", "danger-text"]) {
    assert.notEqual(dark[token], light[token], `--${token} is identical in light and dark`);
  }
});

test("headings on tinted gate surfaces meet WCAG AA in both themes", () => {
  for (const { name, theme } of THEMES) {
    for (const surface of TINTED_SURFACES) {
      const ratio = contrast(theme[surface.text], theme[surface.soft], theme["card"]);
      assert.ok(ratio >= 4.5, `${name}/${surface.name} heading is ${ratio.toFixed(2)}:1, needs 4.5:1`);
    }
  }
});

test("body and muted copy stay legible on tinted gate surfaces", () => {
  for (const { name, theme } of THEMES) {
    for (const surface of TINTED_SURFACES) {
      const body = contrast(theme["muted-strong"], theme[surface.soft], theme["card"]);
      const muted = contrast(theme["muted"], theme[surface.soft], theme["card"]);
      assert.ok(body >= 4.5, `${name}/${surface.name} body is ${body.toFixed(2)}:1, needs 4.5:1`);
      assert.ok(muted >= 3, `${name}/${surface.name} muted is ${muted.toFixed(2)}:1, needs 3:1`);
    }
  }
});

test("page surfaces meet WCAG AA in both themes", () => {
  for (const { name, theme } of THEMES) {
    const pairs: [string, string, string, string, number][] = [
      ["heading on background", theme["foreground"], theme["background"], theme["background"], 4.5],
      ["body on card", theme["muted-strong"], theme["card"], theme["card"], 4.5],
      ["muted on card", theme["muted"], theme["card"], theme["card"], 4.5],
      ["eyebrow on card", theme["brand-dark"], theme["card"], theme["card"], 4.5],
      ["brand chip on card", theme["brand-dark"], theme["brand-soft"], theme["card"], 4.5],
      ["muted on card-elevated", theme["muted"], theme["card-elevated"], theme["card"], 4.5],
    ];
    for (const [label, fg, bg, backdrop, min] of pairs) {
      const ratio = contrast(fg, bg, backdrop);
      assert.ok(ratio >= min, `${name} ${label} is ${ratio.toFixed(2)}:1, needs ${min}:1`);
    }
  }
});

test("the dark theme is genuinely dark and the light theme genuinely light", () => {
  const lum = (t: Theme) => luminance(toRgb(t["background"]));
  assert.ok(lum(light) > 0.7, "light background should be bright");
  assert.ok(lum(dark) < 0.05, "dark background should be near-black");
  assert.ok(lum(dark) < lum(light), "dark background must be darker than light");
});

test("the gate and admin screens use theme tokens rather than a fixed palette", () => {
  // Pages that own their markup and therefore must reference the tokens.
  const styled = [
    "components/auth/gate.tsx",
    "components/auth/join-team-form.tsx",
    "app/(admin)/admin/admins/page.tsx",
    "app/(admin)/admin/security/page.tsx",
  ];
  // Thin wrappers: all styling is delegated to the themed gate component.
  const delegating = [
    "app/(auth)/access-pending/page.tsx",
    "app/(auth)/access-denied/page.tsx",
    "app/(auth)/two-factor-required/page.tsx",
  ];
  // Classes that were the source of the dark-mode bug: light washes and light
  // chips with no dark-mode override.
  const forbidden = [
    "bg-violet-50",
    "border-violet-200",
    "text-violet-950",
    "bg-orange-100",
    "text-orange-800",
    "border-red-200",
    "bg-red-50/50",
    "bg-red-50/70",
    "bg-amber-50/50",
    "bg-amber-50/70",
    "text-red-900/80",
    "bg-white/70",
  ];

  for (const file of styled) {
    const source = readFileSync(file, "utf8");
    for (const cls of forbidden) {
      assert.ok(!source.includes(cls), `${file} still uses ${cls}, which breaks in dark mode`);
    }
    assert.ok(source.includes("var(--"), `${file} should style from the theme tokens`);
  }

  for (const file of delegating) {
    const source = readFileSync(file, "utf8");
    for (const cls of forbidden) {
      assert.ok(!source.includes(cls), `${file} still uses ${cls}, which breaks in dark mode`);
    }
    assert.ok(
      source.includes("GateShell"),
      `${file} should delegate its layout to the themed GateShell component`,
    );
  }
});

test("globals.css maps the remaining legacy classes in dark mode", () => {
  // These classes are still used by the pre-existing admin screens, so the
  // compatibility table has to keep covering them.
  const darkBlock = css.slice(css.indexOf(':root[data-theme="dark"]'));
  const required = [
    "bg-white/70",
    "bg-stone-50",
    "bg-amber-50/50",
    "bg-red-50/50",
    "bg-violet-100",
    "text-violet-800",
    "text-sky-800",
    "text-emerald-600",
    "text-emerald-800",
    "text-amber-700",
    "text-amber-900/80",
    "text-red-800",
    "border-amber-200",
    "border-red-200",
  ];
  for (const cls of required) {
    assert.ok(darkBlock.includes(cls), `dark theme has no override for ${cls}`);
  }
});
