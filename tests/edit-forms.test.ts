import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

/**
 * Edit dialogs: wiring and dirty state.
 *
 * Two independent bugs, both invisible until an operator opened an editor.
 *
 * 1. `useActionState` always invokes its action as `(previousState, formData)`.
 *    Passing a `(formData) => …` server action straight in handed it the previous
 *    state where the form data belonged, and the first `formData.get("id")`
 *    inside it threw "formData.get is not a function". Nothing in the editor
 *    worked — the button simply did nothing.
 *
 * 2. The save button was live from the moment the dialog opened, so a no-op save
 *    looked like a successful one, and a real save was indistinguishable from it.
 */

const files: string[] = [];
function walk(target: string) {
  if (!existsSync(target)) return;
  if (statSync(target).isFile()) {
    files.push(target);
    return;
  }
  for (const entry of readdirSync(target)) walk(join(target, entry));
}
for (const root of ["app", "components", "lib"]) walk(root);

const inventoryEditor = readFileSync("components/admin/inventory-editor.tsx", "utf8");
const serviceEditor = readFileSync("components/admin/service-editor.tsx", "utf8");
const packageEditor = readFileSync("components/admin/package-editor.tsx", "utf8");
const uploader = readFileSync("components/admin/image-uploader.tsx", "utf8");
const packages = readFileSync("app/(admin)/admin/packages/page.tsx", "utf8");

test("every editor unwraps its action so form data lands in the right argument", () => {
  for (const [name, source] of [
    ["inventory-editor", inventoryEditor],
    ["service-editor", serviceEditor],
    ["package-editor", packageEditor],
  ] as const) {
    assert.match(
      source,
      /useActionState\(\s*async \(_previousState: ActionState, formData: FormData\) => \w+FormAction\(formData\)/,
      `${name} must unwrap the form data; a raw action receives the previous state instead`,
    );
  }
});

test("no component hands a form-only action straight to useActionState", () => {
  // `useActionState(fn)` calls `fn(previousState, formData)`. That is only safe
  // when `fn` already declares both arguments, which is the case for every
  // action in `lib/actions.ts` and `lib/auth-actions.ts`. Anything defined as
  // `(formData) => …` has to be wrapped first.
  const formActions = new Set<string>();
  for (const file of files.filter((entry) => entry.endsWith(".ts") && !entry.includes("client"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/export async function (\w+)\(([^)]*)\)/g)) {
      const [, name, params] = match;
      // A single parameter that is not named like a previous state, or nothing
      // at all, means the function is not a `useActionState` action.
      const trimmed = params.trim();
      const isStateful = trimmed === "" || /prev|previous|state/i.test(trimmed);
      if (!isStateful) formActions.add(name);
    }
  }
  assert.ok(formActions.size > 0, "the scan must find form-only actions to check");

  const problems: string[] = [];
  for (const file of files.filter((entry) => entry.endsWith(".tsx"))) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/useActionState\(\s*([A-Za-z0-9_$]+)\s*,/g)) {
      if (formActions.has(match[1])) {
        problems.push(`${file} passes the form-only action ${match[1]} straight to useActionState`);
      }
    }
  }
  assert.deepEqual(problems, [], `these receive the previous state instead of the form data:\n  ${problems.join("\n  ")}`);
});

test("the save button waits for a real change", () => {
  for (const [name, source] of [
    ["inventory-editor", inventoryEditor],
    ["service-editor", serviceEditor],
    ["package-editor", packageEditor],
  ] as const) {
    assert.match(source, /const \[dirty, setDirty\] = useState\(false\)/, `${name} must start from "nothing changed"`);
    assert.match(source, /<SubmitButton disabled=\{!dirty\}>/, `${name}'s save button must be disabled until a field changes`);
    // Owned by the dialog, not inferred by walking the DOM. The dialog is
    // remounted on every open, so `false` really does mean untouched.
    assert.match(source, /<form action=\{formAction\}[^>]*onChange=\{markDirty\}/, `${name} must detect edits on its own form`);
  }
});

test("the edit dialogs are unmounted on close, so the dirty flag cannot go stale", () => {
  for (const source of [inventoryEditor, serviceEditor, packageEditor]) {
    // The dialog is conditionally rendered rather than hidden with `display:
    // none`, so closing it destroys the `dirty` state and reopening always
    // starts from the stored record. Whitespace and the optional paren are
    // matched because the multiline form of this ternary is also correct.
    assert.match(
      source,
      /\{open \? \(?\s*<\w+EditDialog/,
      "the dialog must only exist while open",
    );
  }
});

test("a controlled image field still counts as a change", () => {
  // `ImageUploader`'s hidden inputs are React-controlled, so writing them fires
  // no DOM event and the enclosing `<form>` never hears about it. Without an
  // explicit callback the button would stay disabled after the one edit that
  // mattered most — attaching or removing an image.
  assert.match(uploader, /onValueChange\?: \(\) => void/, "the uploader must expose a change callback");
  assert.match(uploader, /function setImage\(nextUrl: string, nextPublicId: string\)/, "every change must funnel through one place");
  assert.match(uploader, /onValueChange\?\.\(\)/, "the callback must actually be called");
  for (const source of [inventoryEditor, serviceEditor, packageEditor]) {
    assert.match(source, /onValueChange=\{markDirty\}/, "each editor must wire the image field to its dirty flag");
  }
});

test("the same guard is used on every edit form", () => {
  assert.match(inventoryEditor, /disabled=\{!dirty\}/, "the stock editor needs it");
  assert.match(serviceEditor, /disabled=\{!dirty\}/, "the service editor needs it");
  assert.match(packageEditor, /disabled=\{!dirty\}/, "the package editor needs it");
  assert.match(packages, /<PackageEditor/, "the package page must open the dialog, not an inline panel");
  assert.doesNotMatch(packages, /<details className="relative">/, "the clipped inline panel must be gone");
});
