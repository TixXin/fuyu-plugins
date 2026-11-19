// Bundles: a few listed plugins the market offers to install together (format:
// "套装" in docs/architecture/plugins/v3-market.md in TixXin/fuyu). One file per
// bundle, bundles/<id>.json, holding the index entry as it is. Only maintainers
// change them, and for now they hold only official (@fuyu) plugins.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { isOfficialName, parseName } from "./submission.mjs";
import { loadMarket } from "./tools.mjs";

const market = await loadMarket();

export const BUNDLES_DIR = "bundles";
export const BUNDLE_FILE_PATTERN = /^bundles\/[^/]+\.json$/;
const FIELDS = new Set(["id", "displayName", "description", "plugins", "onboarding"]);
const isObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What is wrong with one parsed bundle file, given the names the index lists.
 * The shape and "every member is listed" are the island's own rules: the bundle
 * is checked inside a stand-in index by the pinned @fuyu/plugin-market.
 */
export function bundleProblems(bundle, file, listed) {
  const standIn = {
    format: market.FORMAT,
    serial: 1,
    generatedAt: "2026-01-01T00:00:00Z",
    expires: "2026-01-02T00:00:00Z",
    plugins: [...listed].map((name) => ({ name })),
    bundles: [bundle],
  };
  const problems = market
    .validateIndex(standIn)
    .filter((item) => item.path.startsWith("bundles"))
    .map((item) => `${item.path.replace(/^bundles\[0\]\.?/, "") || "the bundle"} ${item.message}.`);
  if (!isObject(bundle)) return problems;
  for (const key of Object.keys(bundle)) if (!FIELDS.has(key)) problems.push(`"${key}" is not a bundle field.`);
  if (typeof bundle.id === "string" && path.basename(file) !== `${bundle.id}.json`) problems.push(`the file must be named ${bundle.id}.json, after its "id".`);
  for (const name of Array.isArray(bundle.plugins) ? bundle.plugins : []) {
    if (typeof name === "string" && parseName(name) && !isOfficialName(name)) problems.push(`${name}: bundles hold only official (@fuyu) plugins for now.`);
  }
  return problems;
}

/** Every bundle file of `root`, as { file, text }, sorted. */
export function bundleFiles(root) {
  const dir = path.join(root, BUNDLES_DIR);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .map((entry) => ({ entry, file: `${BUNDLES_DIR}/${entry.name}` }))
    .filter(({ entry, file }) => entry.isFile() && BUNDLE_FILE_PATTERN.test(file))
    .map(({ file }) => ({ file, text: readFileSync(path.join(root, file), "utf8") }))
    .sort((left, right) => left.file.localeCompare(right.file));
}

/**
 * The bundles an index listing `listed` may carry, sorted by id, and what is
 * wrong with the rest as "bundles/<id>.json: …" lines. A bundle with a problem
 * (a member that is no longer listed, say) is left out; the index is still made.
 */
export function listedBundles(files, listed) {
  const bundles = [];
  const problems = [];
  for (const { file, text } of files) {
    let bundle;
    try {
      bundle = JSON.parse(text);
    } catch {
      problems.push(`${file}: not valid JSON.`);
      continue;
    }
    const own = bundleProblems(bundle, file, listed);
    if (own.length > 0) problems.push(...own.map((problem) => `${file}: ${problem}`));
    else bundles.push(bundle);
  }
  return { bundles: bundles.sort((left, right) => left.id.localeCompare(right.id)), problems };
}
