import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  facetValue,
  listFacetsFromQuery,
  matchesFacets,
  matchesQuery,
  normalizeQuery,
  rowFacetAttributes,
  rowFacetDatasetKey,
  rowFacetsFromDataset,
  rowFilter,
  rowFilterWithFacets,
  rowText,
  searchTerms,
  type ListFacet,
} from "@/lib/search";

/**
 * Row search.
 *
 * The same rule runs twice — once on the server, which hides the rows that do
 * not match before the first paint, and once in the browser on every keystroke.
 * A regression is silent in the worst way: the page simply shows the wrong rows,
 * so the shared functions are pinned here rather than left to be re-derived.
 */

const rows = [
  rowText("White banquet chairs", "white-banquet-chairs", "CHAIR"),
  rowText("Stage equipment", "stage-equipment", "STAGE_EQUIPMENT"),
  rowText("Catering", "catering", "CATERING"),
];

test("a missing, repeated, or oversized query normalises to something safe", () => {
  assert.equal(normalizeQuery(undefined), "");
  assert.equal(normalizeQuery("  padded  "), "padded");
  // `?q=a&q=b` arrives as an array; only the first value is meaningful.
  assert.equal(normalizeQuery(["first", "second"]), "first");
  assert.equal(normalizeQuery(123 as unknown as string), "");
  // The value is echoed back into the URL and into the empty-state message.
  assert.equal(normalizeQuery("x".repeat(500)).length, 120);
});

test("rowText builds one lower-cased string and drops the empty parts", () => {
  assert.equal(rowText("White chairs", null, undefined, "", "CHAIR", 42), "white chairs chair 42");
});

test("search is case insensitive", () => {
  assert.deepEqual(searchTerms("  White   Chair "), ["white", "chair"]);
  assert.equal(matchesQuery("White banquet chairs", ["chair"]), true);
  assert.equal(matchesQuery("White banquet chairs", ["stages"]), false);
});

test("an empty query matches everything", () => {
  assert.deepEqual(searchTerms(""), []);
  assert.equal(matchesQuery("anything", []), true);
});

test("rowFilter hides nothing when there is no query", () => {
  const show = rowFilter("");
  for (const row of rows) assert.equal(show(row), undefined);
});

test("rowFilter hides non-matching rows and shows the rest", () => {
  const chairs = rowFilter("chair");
  assert.equal(chairs(rows[0]), undefined);
  assert.deepEqual(chairs(rows[1]), { display: "none" });
});

test("every term must match, so words can be reordered", () => {
  const both = rowFilter("banquet white");
  assert.equal(both(rows[0]), undefined);
  assert.deepEqual(both(rows[2]), { display: "none" });
});

test("a query nothing matches hides every row rather than showing all of them", () => {
  // The dangerous failure mode: an unmatched filter that quietly falls back to
  // showing everything looks exactly like the filter not being applied.
  const nothing = rowFilter("helicopter");
  for (const row of rows) assert.deepEqual(nothing(row), { display: "none" });
});

test("hiding is an inline style, which beats a Tailwind display utility", () => {
  // A `hidden` attribute would lose to `class="flex"`, which the cascade emits
  // after preflight, and the row would stay on screen.
  assert.deepEqual(rowFilter("stage")("white banquet chairs"), { display: "none" });
  // A matching row must be left completely untouched — writing `display: ""` over
  // a Tailwind `flex` utility would strip the layout from the row that matched.
  assert.equal(rowFilter("stage")("stage equipment"), undefined);
});

/*
 * Facets — the category, stock, pricing, and status dropdowns.
 *
 * They add a second way to hide a row, and the failure mode is the dangerous one:
 * if the server's first paint and the browser's live filtering disagree about a
 * row, a shared link shows one set of rows and then quietly changes to another
 * the moment anything is touched. So the two share these functions, and these
 * tests pin both halves.
 */
const GROUPS: readonly ListFacet[] = [
  { key: "category", label: "Category", values: ["CHAIR", "TABLE", "DECORATION"] },
  { key: "stock", label: "Stock", values: ["out", "healthy"], labels: { out: "Out of stock", healthy: "Healthy" } },
];

/**
 * What the browser derives from an attribute name when it builds `dataset`: the
 * `data-` prefix goes, and dashes are camel-cased. Stated here so the mapping
 * `rowFacetDatasetKey` performs is checked against the browser's own rule rather
 * than against itself.
 */
function datasetKeyOf(attribute: string): string {
  return attribute.replace(/^data-/, "").replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());
}

/** `rowFacetAttributes`' output, as `row.dataset` would hand it over. */
function toDataset(attributes: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(attributes).map(([name, value]) => [datasetKeyOf(name), value]));
}

/** A table-and-chair arrangement: one row, two categories. */
const arrangement = { category: facetValue("TABLE", "CHAIR"), stock: "healthy" };
const chairsOnly = { category: facetValue("CHAIR"), stock: "out" };
const decor = { category: facetValue("DECORATION"), stock: "healthy" };

test("a facet value joins what a row has, so one row can be in several", () => {
  assert.equal(facetValue("TABLE", "CHAIR"), "TABLE CHAIR");
  assert.equal(facetValue("CHAIR", null, undefined, ""), "CHAIR", "empty parts are dropped");
  assert.equal(facetValue(), "");
});

test("an active facet keeps only the rows that have it", () => {
  assert.equal(matchesFacets(arrangement, { category: "CHAIR" }), true);
  assert.equal(matchesFacets(arrangement, { category: "TABLE" }), true);
  assert.equal(matchesFacets(decor, { category: "CHAIR" }), false);
  // An unselected facet is not a filter.
  assert.equal(matchesFacets(decor, { category: "" }), true);
  assert.equal(matchesFacets(decor, {}), true);
});

test("facets combine, and every one of them has to match", () => {
  assert.equal(matchesFacets(arrangement, { category: "CHAIR", stock: "healthy" }), true);
  // Both match, but not the same row: chairs are out, the arrangement is fine.
  assert.equal(matchesFacets(chairsOnly, { category: "CHAIR", stock: "healthy" }), false);
});

test("a hand-edited or stale facet value is ignored, not honoured", () => {
  // A link with `?category=CHAIR` from before the category list changed must not
  // leave the screen showing "0 of 40" for a value no row has.
  const active = listFacetsFromQuery({ category: "CHAIR", stock: "nonsense", nonsense: "CHAIR" }, GROUPS);
  assert.deepEqual(active, { category: "CHAIR", stock: "" });
  assert.deepEqual(listFacetsFromQuery({ category: ["TABLE", "CHAIR"] }, GROUPS), { category: "TABLE", stock: "" }, "only the first value of a repeated parameter is meaningful");
  assert.deepEqual(listFacetsFromQuery({}, GROUPS), { category: "", stock: "" });
});

test("the row attributes are named after the facet, and the browser reads them back the same way", () => {
  // `data-row-category` has to become `dataset.rowCategory`; a mismatch is a
  // filter that silently matches nothing.
  assert.deepEqual(rowFacetAttributes(arrangement), { "data-row-category": "TABLE CHAIR", "data-row-stock": "healthy" });
  assert.equal(rowFacetAttributes(arrangement)["data-row-category"], "TABLE CHAIR");
  // Checked against the browser's own conversion, not against itself.
  assert.equal(toDataset(rowFacetAttributes(arrangement)).rowCategory, "TABLE CHAIR");
  for (const key of ["category", "stock", "status", "pricing"]) {
    assert.equal(rowFacetDatasetKey(key), datasetKeyOf(`data-row-${key}`), `${key} is not read back under the name the browser gives it`);
  }
});

test("a row's facets are read back under the facet's own name", () => {
  // The regression: the browser built its record keyed by the *dataset* name and
  // then matched it against a selection keyed by the *facet* name. Every row came
  // back owning nothing, so the moment a filter was chosen it matched none of them
  // and the whole list vanished. Nothing in the types or the pure predicates
  // noticed, because both halves were individually correct.
  const dataset = { rowCategory: "TABLE CHAIR", rowStock: "healthy", rowText: "table and chair arrangement" };
  assert.deepEqual(rowFacetsFromDataset(dataset, ["category", "stock"]), { category: "TABLE CHAIR", stock: "healthy" });

  // Which means the row the server wrote is the row the browser reads.
  assert.deepEqual(rowFacetsFromDataset(toDataset(rowFacetAttributes({ category: "TABLE CHAIR", stock: "healthy" })), ["category", "stock"]), { category: "TABLE CHAIR", stock: "healthy" });

  // And a chosen value now matches that row instead of nothing.
  assert.equal(matchesFacets(rowFacetsFromDataset(dataset, ["category"]), { category: "CHAIR" }), true);
  assert.equal(matchesFacets(rowFacetsFromDataset({}, ["category"]), { category: "CHAIR" }), false, "a row with no attribute owns nothing");

  // A row whose attributes are missing is hidden rather than shown: a filter that
  // quietly ignored the rows it could not read would be a filter that lies.
  const missingStock = rowFacetsFromDataset({ rowCategory: "CHAIR" }, ["category", "stock"]);
  assert.equal(matchesFacets(missingStock, { stock: "healthy" }), false);
  // …and still shown when nothing is selected, so old rows are not lost.
  assert.equal(matchesFacets(missingStock, { category: "", stock: "" }), true);
});

test("the server hides on the text query and the facets together", () => {
  const show = rowFilterWithFacets("", { category: "CHAIR", stock: "" });
  assert.equal(show("table and chair arrangement", arrangement), undefined);
  assert.deepEqual(show("entrance decoration", decor), { display: "none" });

  // Both at once, which is the case a shared `?q=chair&category=CHAIR` link is.
  const narrowed = rowFilterWithFacets("chair", { category: "CHAIR", stock: "healthy" });
  assert.equal(narrowed("table and chair arrangement", arrangement), undefined);
  // Matches the text, not the category.
  assert.deepEqual(narrowed("white banquet chairs", chairsOnly), { display: "none" });
  // Matches the category, not the text.
  assert.deepEqual(narrowed("golden seating", arrangement), { display: "none" });
  // Matches neither.
  assert.deepEqual(narrowed("helicopter rental", decor), { display: "none" });
});

test("a row with no facets on it survives an unfiltered list", () => {
  // A row that predates the attributes still has to show when nothing is
  // filtered, or adding the filters would empty the screen for old data.
  const show = rowFilterWithFacets("", { category: "", stock: "" });
  assert.equal(show("anything", {}), undefined);
});

test("every list screen declares its facets where it renders the rows", () => {
  // The two halves of a facet are a declaration and the row attributes. A screen
  // that renders `data-row-text` but declares no facets gets a toolbar with no
  // dropdowns, and one that declares a facet it never writes leaves the filter
  // matching nothing — silently, which is the failure that costs the most time.
  const screens = ["app/(admin)/admin/inventory/page.tsx", "app/(admin)/admin/services/page.tsx"];
  for (const screen of screens) {
    const source = readFileSync(screen, "utf8");
    const declared = [...source.matchAll(/\{ key: "([a-z]+)", label: "([A-Za-z ]+)", values:/g)].map((match) => match[1]);
    assert.ok(declared.length > 0, `${screen} declares no facets`);
    // The object written onto the row has to carry every declared key.
    const block = source.slice(source.indexOf("const facets = {"));
    const facetsOnTheRow = block.slice(0, block.indexOf("};"));
    for (const key of declared) {
      assert.match(facetsOnTheRow, new RegExp(`\\b${key}:\\s`), `${screen} declares the "${key}" facet but never writes it onto a row`);
    }
    assert.match(source, /\.\.\.rowFacetAttributes\(facets\)/, `${screen} never spreads its facets onto the row as data attributes`);
    // The same facet names have to reach the toolbar, or the dropdowns filter a
    // dimension nothing carries.
    assert.match(source, /facets=\{\w+\}/, `${screen} never passes its facets to the toolbar`);
    assert.match(source, /rowFilterWithFacets\(/, `${screen} must narrow its first paint with the same rules the browser uses`);
  }
  // "All" has to be offered, or there is no way back out of a filter.
  assert.match(readFileSync("components/admin/admin-search.tsx", "utf8"), /<option value="">All \{group\.label\.toLowerCase\(\)\}<\/option>/);
  // Both screens agree on what a record's status is called, so the same dropdown
  // means the same thing on each.
  for (const screen of screens) assert.match(readFileSync(screen, "utf8"), /const RECORD_STATES = \["active", "archived"\]/);
});


