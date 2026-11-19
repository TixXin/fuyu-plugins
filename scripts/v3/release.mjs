// After a merge: publishes each built version as a GitHub release (the .fuyu,
// its icon and screenshots) and assembles the unsigned index.v3.json. Runs in a
// job that can write releases but has no signing key and runs no author code: it
// only checks the build job's files against their listed hashes and uploads them.
//
//   node scripts/v3/release.mjs --plan <dir> --builds <dir> --out <dir> [--target <commit>] [--rehearsal]
//
// GITHUB_REPOSITORY, GITHUB_SHA (the default --target) and GH_TOKEN (for `gh`)
// come from Actions. A
// rehearsal (a run on a branch other than main) tags its releases
// "rehearsal-<run id>.…" as pre-releases, which the workflow deletes afterwards.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { bundleFiles } from "./lib/bundles.mjs";
import { INDEX_FILE, currentRevoked, readTrust } from "./lib/documents.mjs";
import { sha256File } from "./lib/listing.mjs";
import { assembleIndex, downloadUrl, indexText, isoSeconds, releaseTag, versionEntry } from "./lib/market-index.mjs";
import { validSubmissions } from "./lib/submission.mjs";
import { ROOT } from "./lib/tools.mjs";

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Checks that the build job's files are the ones its listing names; returns their paths. */
export function verifiedFiles(dir, listing) {
  const files = [
    { name: listing.file, sha256: listing.sha256, size: listing.size },
    { name: listing.icon.file, sha256: listing.icon.sha256 },
    ...listing.screenshots.map((shot) => ({ name: shot.file, sha256: shot.sha256 })),
  ];
  return files.map(({ name, sha256, size }) => {
    if (path.basename(name) !== name) throw new Error(`${name} is not a plain file name.`);
    const file = path.join(dir, name);
    if (!existsSync(file)) throw new Error(`${name} is missing from the build output.`);
    if (sha256File(file) !== sha256 || (size !== undefined && statSync(file).size !== size)) throw new Error(`${name} does not match its listed hash.`);
    return { file, name, sha256 };
  });
}

function gh(args, { allowFailure = false } = {}) {
  const result = spawnSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0 && !allowFailure) throw new Error(`gh ${args.slice(0, 3).join(" ")} failed: ${result.stderr.trim()}`);
  return result.status === 0 ? result.stdout : null;
}

async function downloadSha256(url, attempts = 6) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (attempt > 0) await sleep(5000);
    try {
      const response = await fetch(url, { headers: { "User-Agent": "fuyu-plugins-market" } });
      if (response.ok) return createHash("sha256").update(Buffer.from(await response.arrayBuffer())).digest("hex");
      last = `${response.status}`;
    } catch (error) {
      last = error.message;
    }
  }
  throw new Error(`${url} could not be downloaded (${last}).`);
}

/** Creates the release, or checks that an existing one holds exactly these files; then checks the public addresses. */
export async function ensureRelease({ repo, tag, target, title, notes, files, prerelease, download = downloadSha256, run = gh }) {
  const existing = run(["release", "view", tag, "--repo", repo, "--json", "assets"], { allowFailure: true });
  if (existing === null) {
    const args = ["release", "create", tag, ...files.map((item) => item.file), "--repo", repo, "--target", target, "--title", title, "--notes", notes, "--latest=false"];
    if (prerelease) args.push("--prerelease");
    run(args);
  } else {
    const assets = new Set(JSON.parse(existing).assets.map((asset) => asset.name));
    const missing = files.filter((item) => !assets.has(item.name));
    if (missing.length > 0) run(["release", "upload", tag, ...missing.map((item) => item.file), "--repo", repo]);
  }
  for (const item of files) {
    const actual = await download(downloadUrl(repo, tag, item.name));
    if (actual !== item.sha256) throw new Error(`release ${tag} already holds a different ${item.name}; a listed version never changes.`);
  }
}

export async function releaseAll({ plan, buildsDir, repo, target, runId, rehearsal = false, now = Date.now(), root = ROOT, ensure = ensureRelease }) {
  const released = new Map();
  const failed = [];
  const publishedAt = isoSeconds(now);
  for (const build of plan.builds) {
    const dir = path.join(buildsDir, build.id);
    const status = readJson(path.join(dir, "status.json"));
    const listing = readJson(path.join(dir, "listing.json"));
    if (!status?.ok || !listing) {
      failed.push(`${build.name} ${build.version}: ${status?.error ?? "the build did not finish"}`);
      continue;
    }
    try {
      if (listing.name !== build.name || listing.version !== build.version || listing.commit !== build.commit) throw new Error("the build output is for another version.");
      const files = verifiedFiles(dir, listing);
      const tag = releaseTag(build.name, build.version, rehearsal ? `rehearsal-${runId}` : "v3");
      const notes = [
        `\`${build.name}\` ${build.version}, built by the market from ${build.repository}/tree/${build.commit}${build.path ? `/${build.path}` : ""}`,
        `with TixXin/fuyu@${listing.tools} (fuyu-plugin ${listing.builtWith}). Review: ${listing.tier}.`,
        `sha256 ${listing.sha256}`,
        rehearsal ? "\nRehearsal: deleted when the run ends." : "",
      ].join("\n");
      await ensure({ repo, tag, target, title: `${build.name} ${build.version}`, notes, files, prerelease: rehearsal });
      released.set(`${build.name}@${build.version}`, versionEntry({ ...listing, reviewedAt: build.reviewedAt ?? listing.reviewedAt }, { repo, tag, publishedAt }));
    } catch (error) {
      failed.push(`${build.name} ${build.version}: ${error.message}`);
    }
  }
  const trust = readTrust(root);
  const revoked = currentRevoked(root, trust);
  const previous = readJson(path.join(root, INDEX_FILE));
  const { doc, pending, bundleProblems } = assembleIndex({ submissions: validSubmissions(root), previous, released, now, revokedSerial: revoked?.serial ?? null, bundles: bundleFiles(root) });
  failed.push(...bundleProblems);
  return { doc, released: [...released.keys()], failed, pending };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { plan: { type: "string" }, builds: { type: "string" }, out: { type: "string" }, target: { type: "string" }, rehearsal: { type: "boolean" } } });
  const repo = process.env.GITHUB_REPOSITORY;
  const target = values.target ?? process.env.GITHUB_SHA;
  if (!values.plan || !values.builds || !values.out || !repo || !/^[0-9a-f]{40}$/.test(target ?? "")) {
    console.error("Usage: node scripts/v3/release.mjs --plan <dir> --builds <dir> --out <dir> [--target <commit>] [--rehearsal]; GITHUB_REPOSITORY, GH_TOKEN and GITHUB_SHA or --target set.");
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(path.join(values.plan, "plan.json"), "utf8"));
  const result = await releaseAll({
    plan,
    buildsDir: path.resolve(values.builds),
    repo,
    target,
    runId: process.env.GITHUB_RUN_ID ?? "local",
    rehearsal: Boolean(values.rehearsal),
  });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(path.join(values.out, INDEX_FILE), indexText(result.doc));
  writeFileSync(path.join(values.out, "release.json"), `${JSON.stringify({ released: result.released, failed: result.failed, pending: result.pending, planErrors: plan.errors }, null, 2)}\n`);
  const summary = [
    `### index.v3.json: serial ${result.doc.serial}, expires ${result.doc.expires}`,
    ...(result.doc.bundles ?? []).map((bundle) => `- Bundle ${bundle.id}: ${bundle.plugins.join(", ")}`),
    ...result.released.map((key) => `- Released ${key}`),
    ...result.failed.map((line) => `- ❌ ${line}`),
    ...plan.errors.map((line) => `- ❌ ${line}`),
    ...result.pending.map((key) => `- Not listed yet: ${key}`),
    "",
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}
