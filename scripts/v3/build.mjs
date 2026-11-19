// Builds one planned version the market's way and reviews it against the last
// listed version. Runs in a job with no secrets and a read-only token: it reads
// the author's source and installs its dependencies, so it is treated as running
// hostile code (see lib/source.mjs).
//
//   node scripts/v3/build.mjs --plan <plan.json> --id <id> --out <dir> [--work <dir>]
//
// Writes <out>/<id>/: status.json always; report.md and report.json when the
// review ran; listing.json, the .fuyu, the icon and screenshots when the version
// may be listed. Exits 1 when it may not (build error, red review, leaked secret).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { scanFolder } from "../lib/secrets.mjs";
import { docHashes, extractAssets, fileBase, manifestSummary, platformsOf } from "./lib/listing.mjs";
import { prepareSource } from "./lib/source.mjs";
import { buildConfig, loadCli, toolsPin } from "./lib/tools.mjs";

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function describeError(error) {
  const issues = (error?.issues ?? []).map((issue) => `${issue.file ?? issue.path ?? ""}${issue.line ? `:${issue.line}` : ""} ${issue.message}`.trim());
  return [error instanceof Error ? error.message : String(error), ...issues].join("\n");
}

function checkPackageJson(dir, entry, cli) {
  const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  const problems = [];
  if (pkg.name !== entry.name) problems.push(`package.json at that commit names ${JSON.stringify(pkg.name)}, not ${entry.name}.`);
  if (pkg.version !== entry.version) problems.push(`package.json at that commit is version ${JSON.stringify(pkg.version)}, not ${entry.version}.`);
  const repository = cli.githubUrl(pkg.repository);
  if (repository !== entry.repository) problems.push(`package.json's repository is ${repository ?? "missing"}, not ${entry.repository}.`);
  if (problems.length > 0) throw new Error(problems.join("\n"));
}

/** The previous version's folder and build, or a note on why it is compared as missing. */
async function previousSide(entry, work, cli, config) {
  if (!entry.previous) return { dir: null, built: null, note: null };
  let dir = null;
  try {
    dir = prepareSource(entry.previous, path.join(work, "old"));
  } catch (error) {
    return { dir: null, built: null, note: `The listed version ${entry.previous.version} could not be fetched (${describeError(error)}); this version is reviewed as a first release.` };
  }
  try {
    const result = await cli.build(dir, { ...config, official: entry.official, outDir: path.join(work, "old-built") });
    return { dir, built: result.outDir, note: null };
  } catch (error) {
    return { dir, built: null, note: `The listed version ${entry.previous.version} does not build with these tools (${describeError(error).split("\n")[0]}); only its source is compared.` };
  }
}

export async function buildVersion(entry, { out, work, config = buildConfig() }) {
  const cli = await loadCli();
  const dir = path.join(out, entry.id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const base = fileBase(entry.name, entry.version);
  const status = { id: entry.id, name: entry.name, version: entry.version, commit: entry.commit, ok: false, tier: null, notes: [], warnings: [], error: null };
  try {
    const newDir = prepareSource(entry, path.join(work, "new"));
    checkPackageJson(newDir, entry, cli);
    const packed = await cli.pack(newDir, {
      ...config,
      official: entry.official,
      allowExperimental: false,
      outDir: path.join(work, "new-built"),
      file: path.join(dir, `${base}.fuyu`),
    });
    status.warnings = packed.warnings.map((issue) => `${issue.code ? `${issue.code}: ` : ""}${issue.message}`);
    const previous = await previousSide(entry, work, cli, config);
    if (previous.note) status.notes.push(previous.note);
    const { report, markdown } = cli.reviewSources({ oldSpec: previous.dir ?? "-", newSpec: newDir, oldBuilt: previous.built, newBuilt: packed.outDir });
    writeFileSync(path.join(dir, "report.json"), json(report));
    writeFileSync(path.join(dir, "report.md"), markdown);
    status.tier = report.tier;
    const secrets = scanFolder(packed.outDir);
    if (secrets.length > 0) {
      throw new Error(`the package holds what looks like credentials (revoke them, then publish a version without them):\n${secrets.map((hit) => `${hit.file}:${hit.line} ${hit.kind}`).join("\n")}`);
    }
    if (report.tier === "red") throw new Error("the review is red: the market does not list this version.");
    const built = JSON.parse(readFileSync(path.join(packed.outDir, "package.json"), "utf8"));
    const assets = extractAssets(packed.outDir, built, dir, base);
    const listing = {
      id: entry.id,
      name: entry.name,
      version: entry.version,
      repository: entry.repository,
      commit: entry.commit,
      official: entry.official,
      ...(entry.authorSignature ? { authorSignature: entry.authorSignature } : {}),
      ...(entry.urgent ? { urgent: entry.urgent } : {}),
      ...(entry.reviewedAt ? { reviewedAt: entry.reviewedAt } : {}),
      file: path.basename(packed.file),
      sha256: packed.sha256,
      size: packed.size,
      digest: packed.digest,
      engines: { fuyu: built.engines.fuyu },
      platforms: platformsOf(built),
      manifest: manifestSummary(built),
      icon: assets.icon,
      screenshots: assets.screenshots,
      docs: docHashes(packed.outDir),
      tier: report.tier,
      builtWith: built.fuyu?.builtWith ?? null,
      tools: toolsPin().commit,
    };
    writeFileSync(path.join(dir, "listing.json"), json(listing));
    status.ok = true;
  } catch (error) {
    status.error = describeError(error);
    rmSync(path.join(dir, `${base}.fuyu`), { force: true });
  }
  writeFileSync(path.join(dir, "status.json"), json(status));
  return status;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { plan: { type: "string" }, id: { type: "string" }, out: { type: "string" }, work: { type: "string" } } });
  if (!values.plan || !values.id || !values.out) {
    console.error("Usage: node scripts/v3/build.mjs --plan <plan.json> --id <id> --out <dir> [--work <dir>]");
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(values.plan, "utf8"));
  const entry = plan.builds.find((build) => build.id === values.id);
  if (!entry) {
    console.error(`${values.id} is not in ${values.plan}.`);
    process.exit(2);
  }
  const work = values.work ? path.resolve(values.work) : mkdtempSync(path.join(os.tmpdir(), "fuyu-market-build-"));
  if (!existsSync(work)) mkdirSync(work, { recursive: true });
  const status = await buildVersion(entry, { out: path.resolve(values.out), work });
  console.log(`${entry.name} ${entry.version}: ${status.ok ? `built, review ${status.tier}` : `not listable\n${status.error}`}`);
  for (const note of [...status.notes, ...status.warnings]) console.log(`  ${note}`);
  if (!status.ok) process.exitCode = 1;
}
