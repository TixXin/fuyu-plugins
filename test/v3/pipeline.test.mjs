import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildVersion } from "../../scripts/v3/build.mjs";
import { assembleIndex, ephemeralTrust, indexText, releaseTag, signIndex, versionEntry } from "../../scripts/v3/lib/market-index.mjs";
import { releaseAll, verifiedFiles } from "../../scripts/v3/release.mjs";
import { buildReport } from "../../scripts/v3/report.mjs";
import { toolsDir } from "../../scripts/v3/lib/tools.mjs";
import { DEMO, DEMO_FILE, DEMO_REPO, authorKey, makeMirror, tempDir, versionLine } from "./helpers.mjs";

const installed = existsSync(path.join(toolsDir(), "packages", "plugin-cli", "node_modules", "esbuild"));
const skip = installed ? false : 'run "npm run tools -- --install" first';

test("a clean first release and a poisoned update go through build, review, release and a signed index", { skip, timeout: 180_000 }, async () => {
  const mirror = makeMirror();
  process.env.FUYU_MARKET_GIT_MIRROR = mirror.url;
  const first = mirror.commit("demo-1.0.0");
  const poisoned = mirror.commit("demo-1.1.0");
  const { privateKey, key } = authorKey();
  const lines = [versionLine(privateKey, { version: "1.0.0", commit: first }), versionLine(privateKey, { version: "1.1.0", commit: poisoned })];
  const out = tempDir();
  const base = { name: DEMO, repository: DEMO_REPO, path: "", official: false };
  const builds = [
    { id: "b0", ...base, ...lines[0], previous: null },
    { id: "b1", ...base, ...lines[1], previous: { version: "1.0.0", repository: DEMO_REPO, commit: first, path: "" } },
  ];

  const clean = await buildVersion(builds[0], { out, work: tempDir() });
  assert.equal(clean.ok, true, clean.error);
  assert.equal(clean.tier, "yellow");
  const listing = JSON.parse(readFileSync(path.join(out, "b0", "listing.json"), "utf8"));
  assert.equal(listing.file, "tixxin-market-ci-demo-1.0.0.fuyu");
  assert.deepEqual(listing.platforms, ["windows", "macos"]);
  assert.deepEqual(listing.manifest.network, ["api.open-meteo.com"]);
  assert.equal(listing.icon.file, "tixxin-market-ci-demo-1.0.0.icon.svg");
  assert.equal(typeof listing.docs, "object");
  assert.equal(verifiedFiles(path.join(out, "b0"), listing).length, 2);

  const update = await buildVersion(builds[1], { out, work: tempDir() });
  assert.notEqual(update.tier, "green");
  const review = readFileSync(path.join(out, "b1", "report.md"), "utf8");
  assert.match(review, /child_process/);
  assert.match(review, /collect\.weather-stats\.net/);

  const elsewhere = tempDir();
  const again = await buildVersion(builds[0], { out: elsewhere, work: tempDir() });
  assert.equal(again.ok, true);
  assert.equal(JSON.parse(readFileSync(path.join(elsewhere, "b0", "listing.json"), "utf8")).sha256, listing.sha256);

  writeFileSync(path.join(out, "b0", listing.icon.file), "tampered");
  assert.throws(() => verifiedFiles(path.join(out, "b0"), listing), /does not match its listed hash/);
  writeFileSync(path.join(out, "b0", listing.icon.file), readFileSync(path.join(mirror.root, "TixXin", "fuyu-plugins.git", "assets", "icon.svg")));

  const submission = { name: DEMO, authorKeys: [key], versions: lines };
  const root = tempDir();
  mkdirSync(path.join(root, "plugins", "v3", "tixxin"), { recursive: true });
  mkdirSync(path.join(root, "keys"));
  writeFileSync(path.join(root, DEMO_FILE), JSON.stringify(submission));
  writeFileSync(path.join(root, "keys", "trusted.v3.json"), JSON.stringify({ index: [], revocation: [] }));
  const ensured = [];
  const result = await releaseAll({
    plan: { builds: builds.map((build, index) => ({ ...build, reviewedAt: index === 0 ? "2026-11-15T00:00:00Z" : undefined })) },
    buildsDir: out,
    repo: "TixXin/fuyu-plugins",
    target: "f".repeat(40),
    runId: "1",
    root,
    now: Date.parse("2026-11-16T00:00:00Z"),
    ensure: async (release) => ensured.push(release),
  });
  assert.deepEqual(ensured.map((release) => release.tag), [releaseTag(DEMO, "1.0.0"), releaseTag(DEMO, "1.1.0")].slice(0, update.ok ? 2 : 1));
  assert.equal(result.doc.plugins[0].versions.at(-1).reviewedAt, "2026-11-15T00:00:00Z");
  assert.equal(result.doc.plugins[0].versions.at(-1).url, `https://github.com/TixXin/fuyu-plugins/releases/download/v3.tixxin.market-ci-demo@1.0.0/tixxin-market-ci-demo-1.0.0.fuyu`);
  const { privateKey: indexKey, trust } = ephemeralTrust();
  const signed = signIndex(indexText(result.doc), indexKey, trust);
  assert.equal(signed.doc.plugins[0].name, DEMO);

  const report = buildReport({ plan: { tools: "0".repeat(40), errors: [], notes: [{ name: DEMO, lines: ["First listing: read the whole source."] }], builds }, buildsDir: out, root });
  assert.match(report.body, /^<!-- fuyu-market-v3-report -->/);
  assert.match(report.body, /tixxin-market-ci-demo-1\.0\.0\.fuyu/);
  assert.match(report.body, /首次上架/);
  delete process.env.FUYU_MARKET_GIT_MIRROR;
});

test("an assembled index keeps listed versions as they were and follows the maintainers' urgent flag", () => {
  const { privateKey, key } = authorKey();
  const listing = (version, commit) => ({
    name: DEMO,
    version,
    repository: DEMO_REPO,
    commit,
    authorSignature: versionLine(privateKey, { version, commit }).authorSignature,
    file: `x-${version}.fuyu`,
    sha256: "1".repeat(64),
    size: 10,
    engines: { fuyu: ">=0.4.0" },
    platforms: ["windows"],
    manifest: { displayName: { "zh-CN": "演示", en: "Demo" }, description: { "zh-CN": "演示", en: "Demo" }, license: "MIT", nodeApis: [], network: [], inject: { required: [], optional: [] }, provides: [], replaces: [], slots: [], commands: [] },
    icon: { file: `x-${version}.icon.svg`, sha256: "2".repeat(64) },
    screenshots: [],
    ...(version === "1.0.0" ? { docs: { "README.md": "3".repeat(64) } } : { docs: {} }),
  });
  const a = "a".repeat(40);
  const b = "b".repeat(40);
  const repo = "TixXin/fuyu-plugins";
  const old = versionEntry(listing("1.0.0", a), { repo, tag: releaseTag(DEMO, "1.0.0"), publishedAt: "2026-11-01T00:00:00Z" });
  const previous = { format: 3, serial: 5_000_000_000, generatedAt: "2026-11-01T00:00:00Z", expires: "2026-11-08T00:00:00Z", plugins: [{ name: DEMO, publisher: { github: "TixXin", official: false }, authorKeys: [key], versions: [old] }] };
  const urgent = { reason: { "zh-CN": "修复", en: "Fix" } };
  const lines = [{ ...versionLine(privateKey, { version: "1.0.0", commit: a }), urgent }, versionLine(privateKey, { version: "1.1.0", commit: b })];
  const now = Date.parse("2026-11-15T00:00:00Z");

  const { doc, pending } = assembleIndex({ submissions: [{ name: DEMO, authorKeys: [key], versions: lines }], previous, now, revokedSerial: 3 });
  assert.deepEqual(pending, [`${DEMO}@1.1.0`]);
  assert.equal(doc.serial, 5_000_000_001);
  assert.equal(doc.revokedSerial, 3);
  assert.equal(doc.expires, "2026-11-22T00:00:00Z");
  assert.deepEqual(doc.plugins[0].versions[0].urgent, urgent);
  assert.equal(doc.plugins[0].versions[0].publishedAt, "2026-11-01T00:00:00Z");
  assert.deepEqual(doc.plugins[0].versions[0].docs, { "README.md": "3".repeat(64) });
  assert.equal("docs" in versionEntry(listing("1.1.0", b), { repo, tag: releaseTag(DEMO, "1.1.0"), publishedAt: "2026-11-02T00:00:00Z" }), false);

  const moved = [{ ...versionLine(privateKey, { version: "1.0.0", commit: b }) }];
  assert.throws(() => assembleIndex({ submissions: [{ name: DEMO, authorKeys: [key], versions: moved }], previous, now }), /is listed from/);
});

test("the index is signed only by an index key and must open as the island opens it", () => {
  const { privateKey, trust } = ephemeralTrust();
  const doc = { format: 3, serial: 10, generatedAt: "2026-11-15T00:00:00Z", expires: "2026-11-22T00:00:00Z", plugins: [] };
  const now = Date.parse("2026-11-15T01:00:00Z");
  assert.equal(signIndex(indexText(doc), privateKey, trust, { now }).doc.serial, 10);
  assert.throws(() => signIndex(indexText(doc), privateKey, { index: [], revocation: trust.index }, { now }), /revocation key/);
  assert.throws(() => signIndex(indexText(doc), privateKey, { index: [], revocation: [] }, { now }), /not an index key/);
  assert.throws(() => signIndex(indexText(doc), privateKey, trust, { now, lastSerial: 11 }), /older-serial/);
  assert.throws(() => signIndex(indexText(doc), privateKey, trust, { now: Date.parse("2026-11-23T00:00:00Z") }), /expired/);
});
