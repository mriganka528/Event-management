import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

/**
 * Two screens that quietly trapped the person using them.
 *
 * 1. The category pickers listed eighteen options in a native `<select>`. There
 *    was nothing to type: an admin who wanted the cable behind "Electrical" had
 *    to open the list and scroll, and on a phone the native list covers the form
 *    it belongs to. It is now a control you can type into, which means it also
 *    has to keep doing the three things the native one did — submit the value
 *    under its `name`, leave a stored value alone until it is changed, and never
 *    swallow the Enter key of the form it sits in.
 *
 * 2. On the booking form, an add-on could not be undone. The stepper stopped at
 *    a quantity of one and disabled its own minus button there, so the only way
 *    out was the checkbox — and that checkbox was disabled whenever the line's
 *    category read as exhausted, which is exactly the state a customer ends up
 *    in after somebody else takes the last chairs. The line then could not be
 *    removed at all, and the form refuses to submit while it is there.
 *
 * Both are checked against the source because neither is visible to the type
 * checker: a control that renders perfectly can still submit the wrong value, or
 * refuse to be undone.
 */
const source = (path: string) => readFileSync(path, "utf8");

test("every category picker is searchable", () => {
  const pickers: Array<[string, RegExp]> = [
    ["app/(admin)/admin/inventory/page.tsx", /<SearchableSelect\s+name="category"/],
    ["components/admin/inventory-editor.tsx", /<SearchableSelect\s+name="category"/],
    // The service link goes through one field, so the field is what has to be
    // searchable for both the add and the edit form.
    ["components/admin/inventory-category-field.tsx", /<MultiSearchableSelect[\s\S]*?onValuesChange=\{\(next\)/],
  ];

  for (const [file, pattern] of pickers) {
    assert.match(source(file), pattern, `${file} still offers an unsearchable category list`);
  }
  // A picker nobody types into is a native `<select>` wearing a different name.
  for (const file of pickers.map(([file]) => file)) {
    assert.doesNotMatch(source(file), /<Select\s+name="(category|inventoryCategories?)"/, `${file} kept a plain <select> for the category`);
  }
});

test("the searchable picker still submits, pre-sets, and never eats Enter", () => {
  const control = source("components/ui/searchable-select.tsx");

  // Without the hidden field the server action would receive no category at all,
  // and `inventorySchema` treats it as required.
  assert.match(control, /<input\s+type="hidden"\s+name=\{name\}\s+value=\{committed\}/);
  // A control that paints its first option would rewrite the record on save: the
  // edit dialogs keep Save disabled until a value actually changes, so this is
  // the whole safety of that gate.
  assert.match(control, /const \[committed, setCommitted\] = useState\(selected\)/);
  // Substring rather than prefix, so "tab" reaches "Tablecloth" and "lin" reaches
  // "Linen" — the reason the control exists.
  assert.match(control, /option\.label\.toLowerCase\(\)\.includes\(lower\)/);
  // A typed-in value is kept when it is not on the list, and shown as it stands.
  assert.match(control, /if \(allowCustomValue && needle && !filtered\.some\(/);
  assert.match(control, /return match\?\.label \?\? selected;/);
  // Enter picks the highlighted option instead of submitting the surrounding
  // admin form with a half-filled field.
  assert.match(control, /if \(event\.key === "Enter"\)[\s\S]{0,320}event\.preventDefault\(\)/);
  // A listbox the keyboard can be driven through.
  assert.match(control, /role="listbox"/);
  assert.match(control, /aria-activedescendant=/);
});

test("a picker that edits a stored value is pre-set to it", () => {
  // Same rule the role and staff-type selectors are held to: no `defaultValue`
  // means the first option is painted, and saving an untouched form rewrites
  // the record to it.
  assert.match(
    source("components/admin/inventory-editor.tsx"),
    /<SearchableSelect\s+name="category"[^>]*defaultValue=\{item\.category\}/,
    "the inventory category editor must open on the item's stored category",
  );
  // The dialogs count a change through the callback: a button click fires neither
  // `change` nor `input`, so the form's own handlers never see it.
  assert.match(source("components/admin/inventory-editor.tsx"), /onValueChange=\{markDirty\}/);
  assert.match(source("components/admin/service-editor.tsx"), /onValueChange=\{markDirty\}/);
});

test("both service forms offer the whole unit list, not one stored value", () => {
  // The regression: the edit dialog's unit label was a plain text input, so the
  // only thing on screen was whatever the service already had stored — one
  // suggestion, and not one that was ever offered. The add form had the list in a
  // `<datalist>`, which a browser only shows once there is something to type, so
  // picking a unit from a blank field had nothing to pick from either.
  const add = source("app/(admin)/admin/services/page.tsx");
  const edit = source("components/admin/service-editor.tsx");

  for (const [name, body] of [["the add form", add], ["the edit dialog", edit]] as const) {
    assert.match(body, /<SearchableSelect[\s\S]*?name="unitLabel"/, `${name} has no unit picker`);
    assert.doesNotMatch(body, /list="service-unit-suggestions"/, `${name} is still on a datalist`);
    assert.match(body, /allowCustomValue/, `${name} must still accept a unit that is not on the list`);
  }
  assert.match(edit, /defaultValue=\{service\.unitLabel\}/, "the editor must open on the service's own unit");

  // A unit the admin makes up has to survive: the schema takes any short string,
  // and a closed list would push them back to a free-text box for "per batch".
  assert.match(source("lib/validation.ts"), /unitLabel: z\.string\(\)\.trim\(\)\.min\(1\)\.max\(30\)/);
  assert.match(source("components/ui/searchable-select.tsx"), /Use “\{option\.label\}”/);

  // The list itself, grouped by what it is for rather than alphabetised.
  const suggestions = source("lib/suggestions.ts");
  for (const unit of ["setup", "flat", "guest", "plate", "table", "hour", "day", "session", "week", "metre", "square foot", "item", "trip"]) {
    assert.match(suggestions, new RegExp(`^  "${unit}",$`, "m"), `the unit "${unit}" is missing from the list`);
  }
  // Bare units only: the price line already reads "per {label}" everywhere.
  assert.doesNotMatch(suggestions.slice(suggestions.indexOf("UNIT_LABEL_SUGGESTIONS")), /^  "per /m);
});

test("a selected booking line can always be removed", () => {  const form = source("components/booking/booking-form.tsx");

  // The minus button disabled itself at one, which is what made the line
  // irreversible from the stepper.
  const handler = "onClick={() => changeQuantity(service.id, -1)}";
  const at = form.indexOf(handler);
  assert.ok(at > 0, "the decrement button is missing, so the scan is broken");
  // The element is whatever `<Button` opens the tag holding that handler — not
  // the first one in the file, which is the "send another request" button.
  const decrement = form.slice(form.lastIndexOf("<Button", at), form.indexOf(">", at));
  assert.doesNotMatch(decrement, /disabled=/, "the decrement button must never be disabled");
  assert.match(decrement, /type="button"/, "a stepper button must not submit the form");

  // Un-ticking is the other way out, so it has to survive the category running
  // out underneath a line that is already selected.
  assert.match(form, /disabled=\{unavailable && !selected\}/);
  assert.doesNotMatch(form, /disabled=\{unavailable\}/, "an exhausted category must not lock in a line already chosen");

  // And the rule both of those rely on lives in one tested place.
  assert.match(form, /applyQuantityStep\(current, serviceId, delta, limit\)/);
  assert.doesNotMatch(form, /Math\.max\(1, \(current\[serviceId\]/, "the old floor of one is what pinned the line");

  // At a quantity of one the button says what it will do.
  assert.match(form, /aria-label=\{selectedServices\[service\.id\] <= 1 \? `Remove \$\{service\.name\}`/);
});

test("per-day pricing is a mode the whole quote agrees on", () => {
  // A service can be priced per day, so a quote has to know how many days it runs
  // for. Three places have to be told or they quietly disagree: the estimate the
  // customer reads, the stock the form reserves, and the price the server takes.
  const form = source("components/booking/booking-form.tsx");
  const pricing = source("lib/pricing.ts");
  const validation = source("lib/validation.ts");

  // The day count is asked for only when it can change something.
  assert.match(form, /const usesPerDay = useMemo/);
  assert.match(form, /name="durationDays"/);
  assert.match(form, /\{usesPerDay \? \(/);
  // The estimate multiplies the line by the days, exactly as the server does.
  assert.match(form, /isPerDay\.get\(serviceId\) \? quantity \* days : quantity/);
  // And the same for the stock it draws on.
  assert.match(form, /isPerDay\.get\(service\.id\) \? base \* days : base/);
  assert.match(pricing, /pricingMode === "PER_DAY" \? item\.quantity \* days/);
  // Absent from the request means one day, never zero.
  assert.match(validation, /durationDays: numberInput[\s\S]*?\.default\(1\)/);

  // An admin can actually pick it.
  assert.match(source("app/(admin)/admin/services/page.tsx"), /label: "Per day", value: PricingMode\.PER_DAY/);
});
