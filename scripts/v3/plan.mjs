// Decides which plugin versions to build, and checks everything that needs no
// build: submission files, author signatures, who may change what, official
// commits, bundles, revoked.v3.json and the trust root.
//
//   node scripts/v3/plan.mjs --mode pr --out <dir>       a pull request (BASE_SHA, PR_AUTHOR, AUTHOR_ASSOCIATION)
//   node scripts/v3/plan.mjs --mode publish --out <dir>  the branch as it is: versions not yet in index.v3.json
//
// Writes <dir>/plan.json and, under Actions, the outputs "ids" (JSON list) and "count".
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { api } from "../lib/github.mjs";
import { BUNDLES_DIR, BUNDLE_FILE_PATTERN, listedBundles } from "./lib/bundles.mjs";
import { INDEX_FILE, REVOKED_FILE, TRUST_FILE, parseTrust, revokedChangeProblems, signatureFile, trustProblems } from "./lib/documents.mjs";
import { changedFiles, fileAt, firstAddedAt } from "./lib/git.mjs";
import { onProtectedMain } from "./lib/official.mjs";
import { FILE_PATTERN, V3_DIR, compareSubmissions, isOfficialName, latestOf, ownerOf, previousOf, submissionFiles, submissionProblems } from "./lib/submission.mjs";
import { ROOT, toolsPin } from "./lib/tools.mjs";

const MAINTAINERS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** True when `user` owns the GitHub repository at `repository`, or is a public member of the organization that does. */
export async function ownsRepository(user, repository, request = api) {
  const owner = ownerOf(repository);
  if (!owner || !user) return false;
  if (owner.toLowerCase() === user.toLowerCase()) return true;
  const { status } = await request(`/orgs/${owner}/public_members/${user}`);
  return status === 204;
}

function parse(text, file, errors) {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    errors.push(`${file}: not valid JSON.`);
    return undefined;
  }
}

const buildEntry = (submission, line, previous, extra = {}) => ({
  name: submission.name,
  version: line.version,
  repository: line.repository,
  commit: line.commit,
  path: submission.path ?? "",
  official: isOfficialName(submission.name),
  ...(line.authorSignature ? { authorSignature: line.authorSignature } : {}),
  ...(line.urgent ? { urgent: line.urgent } : {}),
  previous: previous ? { version: previous.version, repository: previous.repository, commit: previous.commit, path: previous.path ?? submission.path ?? "" } : null,
  ...extra,
});

async function checkOfficial(submission, lines, errors, file, request) {
  for (const line of lines) {
    const result = await onProtectedMain(line.commit, line.repository, { request });
    if (!result.ok) errors.push(`${file}: version ${line.version}: ${result.reason}`);
  }
}

/** A pull request: only the files it changes, checked against who opened it. */
export async function planPullRequest(root, { base, author, association, request = api, now = Date.now() }) {
  const errors = [];
  const notes = [];
  const builds = [];
  const maintainer = MAINTAINERS.has(association);
  const changes = changedFiles(base, root);

  for (const { file } of changes) {
    if (file.startsWith(`${V3_DIR}/`) && !FILE_PATTERN.test(file)) errors.push(`${file}: submissions go in ${V3_DIR}/<scope>/<name>.json.`);
  }
  for (const { status, file } of changes.filter((change) => FILE_PATTERN.test(change.file))) {
    const before = parse(fileAt(base, file, root), file, errors);
    const after = status === "D" ? null : parse(readFileSync(path.join(root, file), "utf8"), file, errors);
    if (before === undefined || after === undefined) continue;
    const own = [];
    if (after) own.push(...submissionProblems(after, file).map((problem) => `${file}: ${problem}`));
    const compared = compareSubmissions(before, after, { maintainer });
    own.push(...compared.errors.map((problem) => `${file}: ${problem}`));
    if (after && own.length === 0) {
      if (isOfficialName(after.name)) {
        if (!maintainer && compared.added.length > 0) own.push(`${file}: only maintainers may submit official plugins.`);
        else await checkOfficial(after, compared.added, own, file, request);
      } else if (!maintainer) {
        const repositories = new Set(compared.added.map((line) => line.repository));
        const last = latestOf(before?.versions ?? []);
        if (last && compared.added.some((line) => line.repository !== last.repository)) repositories.add(last.repository);
        for (const repository of repositories) {
          if (!(await ownsRepository(author, repository, request))) own.push(`${file}: @${author} must own ${repository} (be its owner, or a public member of its organization).`);
        }
      }
    }
    errors.push(...own);
    notes.push({ name: (after ?? before)?.name ?? file, lines: compared.notes });
    if (after && own.length === 0) {
      for (const line of compared.added) builds.push(buildEntry(after, line, previousOf(line.version, after.versions), {}));
    }
  }

  const bundleChanges = changes.filter(({ file }) => file.startsWith(`${BUNDLES_DIR}/`));
  if (bundleChanges.length > 0) {
    const listed = new Set((parse(fileAt(base, INDEX_FILE, root), INDEX_FILE, errors)?.plugins ?? []).map((plugin) => plugin.name));
    for (const { status, file } of bundleChanges) {
      if (!BUNDLE_FILE_PATTERN.test(file)) errors.push(`${file}: bundles go in ${BUNDLES_DIR}/<id>.json.`);
      else if (!maintainer) errors.push(`${file}: only maintainers may change bundles.`);
      else if (status === "D") notes.push({ name: file, lines: ["Removed: islands stop offering this bundle; what it installed stays."] });
      else {
        const checked = listedBundles([{ file, text: readFileSync(path.join(root, file), "utf8") }], listed);
        errors.push(...checked.problems);
        const [bundle] = checked.bundles;
        if (bundle) {
          notes.push({
            name: file,
            lines: [`Bundle of ${bundle.plugins.length} listed plugins: ${bundle.plugins.join(", ")}.`, ...(bundle.onboarding ? ["Recommended in the first-run guide."] : [])],
          });
        }
      }
    }
  }

  if (changes.some(({ file }) => file === TRUST_FILE)) {
    const text = fileAt("HEAD", TRUST_FILE, root);
    let trust = null;
    try {
      trust = text == null ? null : JSON.parse(text);
    } catch {
      errors.push(`${TRUST_FILE} is not valid JSON.`);
    }
    if (trust) errors.push(...trustProblems(trust));
    notes.push({ name: TRUST_FILE, lines: ["The trust root changed. The island compiles in the same keys: change both together."] });
  }
  if (changes.some(({ file }) => file === REVOKED_FILE || file === signatureFile(REVOKED_FILE))) {
    const baseTrustText = fileAt(base, TRUST_FILE, root);
    let trust = { index: [], revocation: [] };
    try {
      if (baseTrustText != null) trust = parseTrust(baseTrustText);
    } catch (error) {
      errors.push(error.message);
    }
    const problems = revokedChangeProblems({
      before: fileAt(base, REVOKED_FILE, root),
      beforeSignature: fileAt(base, signatureFile(REVOKED_FILE), root),
      after: fileAt("HEAD", REVOKED_FILE, root),
      afterSignature: fileAt("HEAD", signatureFile(REVOKED_FILE), root),
      trust,
      now,
    });
    errors.push(...problems);
    if (problems.length === 0) notes.push({ name: REVOKED_FILE, lines: ["Signed by a revocation key; entries only grow."] });
  }
  return { mode: "pr", errors, notes: notes.filter((note) => note.lines.length > 0), builds };
}

/** The branch as it is: every submitted version that index.v3.json does not list yet. */
export async function planPublish(root, { request = api, now = Date.now() } = {}) {
  const errors = [];
  const notes = [];
  const builds = [];
  const indexPath = path.join(root, INDEX_FILE);
  const index = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, "utf8")) : null;
  const listed = new Map((index?.plugins ?? []).map((plugin) => [plugin.name, plugin]));
  const nowText = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");

  for (const { file, text } of submissionFiles(root)) {
    const submission = parse(text, file, errors);
    if (!submission) continue;
    const problems = submissionProblems(submission, file);
    if (problems.length > 0) {
      errors.push(...problems.map((problem) => `${file}: ${problem}`));
      continue;
    }
    const plugin = listed.get(submission.name);
    const entries = new Map((plugin?.versions ?? []).map((entry) => [entry.version, entry]));
    const pending = [];
    for (const line of submission.versions) {
      const entry = entries.get(line.version);
      if (!entry) pending.push(line);
      else if (entry.commit !== line.commit || entry.repository !== line.repository) {
        errors.push(`${file}: version ${line.version} is listed from ${entry.repository}@${entry.commit}, but the submission says ${line.repository}@${line.commit}.`);
      }
    }
    if (pending.length === 0) continue;
    const own = [];
    if (isOfficialName(submission.name)) await checkOfficial(submission, pending, own, file, request);
    errors.push(...own);
    if (own.length > 0) continue;
    const listedVersions = [...entries.values()].map((entry) => ({ ...entry, path: submission.path ?? "" }));
    for (const line of pending) {
      const reviewedAt = firstAddedAt(line.commit, file, { cwd: root }) ?? nowText;
      builds.push(buildEntry(submission, line, previousOf(line.version, listedVersions), { reviewedAt }));
    }
    notes.push({ name: submission.name, lines: pending.map((line) => `To list: ${line.version} (${line.commit}).`) });
  }
  return { mode: "publish", errors, notes, builds };
}

export function writePlan(plan, out) {
  const withIds = { ...plan, tools: toolsPin().commit, builds: plan.builds.map((build, index) => ({ id: `b${index}`, ...build })) };
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "plan.json"), `${JSON.stringify(withIds, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `ids=${JSON.stringify(withIds.builds.map((build) => build.id))}\ncount=${withIds.builds.length}\n`);
  }
  return withIds;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { mode: { type: "string" }, out: { type: "string" } } });
  if (!["pr", "publish"].includes(values.mode) || !values.out) {
    console.error("Usage: node scripts/v3/plan.mjs --mode pr|publish --out <dir>");
    process.exit(2);
  }
  const plan =
    values.mode === "pr"
      ? await planPullRequest(ROOT, { base: process.env.BASE_SHA, author: process.env.PR_AUTHOR ?? "", association: process.env.AUTHOR_ASSOCIATION ?? "NONE" })
      : await planPublish(ROOT);
  const written = writePlan(plan, path.resolve(values.out));
  for (const error of written.errors) console.error(`error: ${error}`);
  for (const build of written.builds) console.log(`build ${build.id}: ${build.name} ${build.version} (${build.commit})${build.previous ? `, compared with ${build.previous.version}` : ""}`);
  if (written.builds.length === 0) console.log("Nothing to build.");
}
