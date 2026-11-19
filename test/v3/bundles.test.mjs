import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { bundleFiles, bundleProblems, listedBundles } from "../../scripts/v3/lib/bundles.mjs";
import { assembleIndex, ephemeralTrust, indexText, signIndex } from "../../scripts/v3/lib/market-index.mjs";
import { ROOT } from "../../scripts/v3/lib/tools.mjs";
import { planPullRequest } from "../../scripts/v3/plan.mjs";
import { commitAll, initRepo, run, tempDir } from "./helpers.mjs";

const REPO = "https://github.com/TixXin/fuyu";
const NOW = Date.parse("2026-11-20T00:00:00Z");
const text = (zh, en) => ({ "zh-CN": zh, en });
const flow = (extra = {}) => ({ id: "flow", displayName: text("专注", "Focus"), description: text("两个一起用", "Two that go together"), plugins: ["@fuyu/pomodoro", "@fuyu/todo-ring"], ...extra });
const file = (bundle, name = `bundles/${bundle.id}.json`) => ({ file: name, text: JSON.stringify(bundle) });

function entry(version, commit) {
  return {
    version,
    repository: REPO,
    commit,
    engines: { fuyu: ">=0.4.0" },
    platforms: ["windows", "macos"],
    url: `https://github.com/TixXin/fuyu-plugins/releases/download/v/x-${version}.fuyu`,
    sha256: "1".repeat(64),
    size: 10,
    publishedAt: "2026-11-01T00:00:00Z",
    reviewedAt: "2026-11-01T00:00:00Z",
    manifest: { displayName: text("演示", "Demo"), description: text("演示", "Demo"), license: "MIT", nodeApis: [], network: [], inject: { required: [], optional: [] }, provides: [], replaces: [], slots: [], commands: [] },
    icon: { url: `https://github.com/TixXin/fuyu-plugins/releases/download/v/x-${version}.icon.svg`, sha256: "2".repeat(64) },
  };
}

/** Submissions and the index that already lists them, for official plugins named `names`. */
function listed(names) {
  const commit = "a".repeat(40);
  const submissions = names.map((name) => ({ name, versions: [{ version: "1.0.0", repository: REPO, commit }] }));
  const plugins = names.map((name) => ({ name, publisher: { github: "TixXin", official: true }, authorKeys: [], versions: [entry("1.0.0", commit)] }));
  return { submissions, previous: { format: 3, serial: 100, generatedAt: "2026-11-01T00:00:00Z", expires: "2026-11-08T00:00:00Z", plugins } };
}

test("without bundle files the index has no bundles field, so it stays what older islands already read", () => {
  const { submissions, previous } = listed(["@fuyu/pomodoro", "@fuyu/todo-ring"]);
  const { doc, bundleProblems: problems } = assembleIndex({ submissions, previous, now: NOW });
  assert.equal("bundles" in doc, false);
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(doc), ["format", "serial", "generatedAt", "expires", "plugins"]);
});

test("bundle files go into the index sorted by id, and the signed result opens as the island opens it", () => {
  const { submissions, previous } = listed(["@fuyu/pomodoro", "@fuyu/todo-ring"]);
  const bundles = [file(flow({ id: "zen" })), file(flow({ onboarding: true }))];
  const { doc, bundleProblems: problems } = assembleIndex({ submissions, previous, now: NOW, bundles });
  assert.deepEqual(problems, []);
  assert.deepEqual(doc.bundles, [flow({ onboarding: true }), flow({ id: "zen" })]);
  const { privateKey, trust } = ephemeralTrust();
  assert.deepEqual(signIndex(indexText(doc), privateKey, trust, { now: NOW }).doc.bundles.map((bundle) => bundle.id), ["flow", "zen"]);
});

test("a bundle whose member is no longer listed is left out and reported; the rest of the index is still made", () => {
  const { submissions, previous } = listed(["@fuyu/pomodoro", "@fuyu/todo-ring"]);
  const gone = file(flow({ id: "gone", plugins: ["@fuyu/pomodoro", "@fuyu/weather"] }));
  const { doc, bundleProblems: problems } = assembleIndex({ submissions, previous, now: NOW, bundles: [gone, file(flow()), { file: "bundles/broken.json", text: "{" }] });
  assert.deepEqual(doc.bundles.map((bundle) => bundle.id), ["flow"]);
  assert.equal(doc.plugins.length, 2);
  assert.match(problems.join("\n"), /bundles\/gone\.json: plugins\[1\] @fuyu\/weather is not in this index/);
  assert.match(problems.join("\n"), /bundles\/broken\.json: not valid JSON/);
  const only = assembleIndex({ submissions, previous, now: NOW, bundles: [gone] });
  assert.equal("bundles" in only.doc, false);
});

test("a bundle file is checked by the island's rules, its name, its fields and who its members are", () => {
  const known = new Set(["@fuyu/pomodoro", "@fuyu/todo-ring", "@someone/clock"]);
  const problems = (bundle, name = "bundles/flow.json") => bundleProblems(bundle, name, known).join("\n");
  assert.equal(problems(flow()), "");
  assert.match(problems(flow(), "bundles/other.json"), /must be named flow\.json/);
  assert.match(problems(flow({ plugins: ["@fuyu/pomodoro"] })), /plugins must list 2 to 6 plugin names/);
  assert.match(problems(flow({ plugins: ["@fuyu/pomodoro", "@fuyu/pomodoro"] })), /plugins/);
  assert.match(problems(flow({ plugins: ["@fuyu/pomodoro", "@someone/clock"] })), /@someone\/clock: bundles hold only official/);
  assert.match(problems(flow({ displayName: { en: "Focus" } })), /displayName needs zh-CN and en/);
  assert.match(problems(flow({ onboarding: "yes" })), /onboarding must be true or false/);
  assert.match(problems(flow({ onboard: true })), /"onboard" is not a bundle field/);
  assert.match(problems(flow({ id: "Flow" }), "bundles/Flow.json"), /id must be lowercase/);
  assert.match(problems([]), /the bundle must be an object/);
  assert.deepEqual(listedBundles([file(flow())], known), { bundles: [flow()], problems: [] });
});

function write(root, name, value) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

function checkout(before = {}) {
  const root = initRepo(tempDir());
  write(root, "index.v3.json", listed(["@fuyu/pomodoro", "@fuyu/todo-ring"]).previous);
  for (const [name, value] of Object.entries(before)) write(root, name, value);
  const base = commitAll(root, "base");
  run("git", ["switch", "-q", "-c", "pr"], root);
  return { root, base };
}

const noApi = async (url) => {
  throw new Error(`unexpected request ${url}`);
};
const asOwner = { author: "TixXin", association: "OWNER", request: noApi };

test("a pull request may add a bundle of listed plugins, and only a maintainer may", async () => {
  const { root, base } = checkout();
  write(root, "bundles/flow.json", flow({ onboarding: true }));
  commitAll(root, "bundle");
  const plan = await planPullRequest(root, { base, ...asOwner });
  assert.deepEqual(plan.errors, []);
  assert.equal(plan.builds.length, 0);
  assert.deepEqual(plan.notes, [{ name: "bundles/flow.json", lines: ["Bundle of 2 listed plugins: @fuyu/pomodoro, @fuyu/todo-ring.", "Recommended in the first-run guide."] }]);
  const outsider = await planPullRequest(root, { base, author: "someone", association: "NONE", request: noApi });
  assert.match(outsider.errors.join("\n"), /bundles\/flow\.json: only maintainers may change bundles/);
});

test("a pull request cannot list a bundle by rewriting the index, misplacing the file or naming an unlisted plugin", async () => {
  const { root, base } = checkout();
  const wider = listed(["@fuyu/pomodoro", "@fuyu/todo-ring", "@fuyu/weather"]).previous;
  write(root, "index.v3.json", wider);
  write(root, "bundles/flow.json", flow({ plugins: ["@fuyu/pomodoro", "@fuyu/weather"] }));
  write(root, "bundles/nested/deep.json", flow({ id: "deep" }));
  write(root, "bundles/notes.txt", "x");
  commitAll(root, "bundles");
  const errors = (await planPullRequest(root, { base, ...asOwner })).errors.join("\n");
  assert.match(errors, /bundles\/flow\.json: plugins\[1\] @fuyu\/weather is not in this index/);
  assert.match(errors, /bundles\/nested\/deep\.json: bundles go in bundles\/<id>\.json/);
  assert.match(errors, /bundles\/notes\.txt: bundles go in bundles\/<id>\.json/);
});

test("removing a bundle is noted, not checked", async () => {
  const { root, base } = checkout({ "bundles/flow.json": flow() });
  rmSync(path.join(root, "bundles/flow.json"));
  commitAll(root, "remove");
  const plan = await planPullRequest(root, { base, ...asOwner });
  assert.deepEqual(plan.errors, []);
  assert.match(plan.notes[0].lines[0], /^Removed/);
});

test("the bundles of this repository are ones its index can list", { skip: existsSync(path.join(ROOT, "index.v3.json")) ? false : "no index.v3.json here" }, () => {
  const index = JSON.parse(readFileSync(path.join(ROOT, "index.v3.json"), "utf8"));
  const { problems } = listedBundles(bundleFiles(ROOT), new Set(index.plugins.map((plugin) => plugin.name)));
  assert.deepEqual(problems, []);
});
