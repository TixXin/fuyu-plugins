// Approves a pull request on the market's behalf when it is a collaborator's
// routine update of a plugin they already listed, so they can merge it without
// waiting for a maintainer. Everything else still waits for a person.
//
//   node scripts/v3/approve.mjs --plan <plan.json> --builds <dir> --pr-file <pr.json> --head-sha <sha>
//
// Runs from the "Approve routine v3 updates" workflow on the default branch's
// code, after a "Check submission" run that succeeded. Its inputs are that run's
// artifacts, which a fork controls; they are trusted only because the pull
// request may change nothing but plugins/v3/<its author>/<name>.json, so the run
// that made them used the market's own workflow and scripts (and the build never
// runs the author's code, see lib/source.mjs). Approves only when all hold:
//   - the pull request is open, against main, not a draft, its head is the
//     checked commit, and its author is a collaborator, member or owner
//   - every changed file is an existing plugins/v3/<author>/<name>.json
//   - the plan has no problems and no notes: no first listing, no new or removed
//     key, no moved repository or folder, no urgent, no removed version
//   - every planned version is the author's own, compared with a listed version
//     from the same repository, built, and reviewed green with no notes
// The approval is for that commit; the ruleset dismisses it on the next push.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { api } from "../lib/github.mjs";
import { all } from "./comment.mjs";

const TRUSTED = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const SUBMISSION = /^plugins\/v3\/([a-z0-9][a-z0-9-]*)\/[a-z0-9][a-z0-9._-]*\.json$/;
const BOT = "github-actions[bot]";

const scopeOf = (name) => /^@([^/]+)\//.exec(name ?? "")?.[1] ?? null;

/** Why the market should not approve this pull request; an empty list means it may. */
export function reasonsAgainst({ pull, headSha, files, plan, statuses }) {
  const reasons = [];
  const author = pull.user?.login?.toLowerCase() ?? "";
  if (pull.state !== "open") reasons.push(`the pull request is ${pull.state}.`);
  if (pull.draft) reasons.push("the pull request is a draft.");
  if (pull.base?.ref !== pull.base?.repo?.default_branch) reasons.push(`the pull request is against ${pull.base?.ref}, not the default branch.`);
  if (pull.head?.sha !== headSha) reasons.push(`its head is ${pull.head?.sha}, not the checked ${headSha}.`);
  if (!TRUSTED.has(pull.author_association)) reasons.push(`@${pull.user?.login} is not a collaborator of the market (${pull.author_association}).`);
  if (!author || author === "fuyu") reasons.push("no author to match the scope against.");

  if (files.length === 0) reasons.push("the pull request changes no file.");
  for (const file of files) {
    const scope = SUBMISSION.exec(file.filename)?.[1];
    if (!scope) reasons.push(`${file.filename} is not a v3 submission file.`);
    else if (scope !== author) reasons.push(`${file.filename} is not in @${author}'s scope.`);
    else if (file.status !== "modified") reasons.push(`${file.filename} is ${file.status}, not an update of a listed plugin.`);
  }

  if (!plan) return [...reasons, "the plan is missing."];
  if (plan.mode !== "pr") reasons.push(`the plan is for ${plan.mode}, not a pull request.`);
  if ((plan.errors ?? []).length > 0) reasons.push("the plan has problems.");
  for (const note of plan.notes ?? []) reasons.push(`${note.name}: ${note.lines.join(" ")}`);
  if ((plan.builds ?? []).length === 0) reasons.push("no version to list.");
  for (const build of plan.builds ?? []) {
    const label = `${build.name} ${build.version}`;
    const status = statuses[build.id];
    if (build.official || scopeOf(build.name) !== author) reasons.push(`${label} is not @${author}'s plugin.`);
    if (build.urgent) reasons.push(`${label} is marked urgent.`);
    if (!build.previous) reasons.push(`${label} has no listed version to compare with.`);
    else if (build.previous.repository !== build.repository) reasons.push(`${label} comes from another repository than ${build.previous.version}.`);
    if (!status) reasons.push(`${label} has no build result.`);
    else {
      if (!status.ok || status.id !== build.id || status.name !== build.name || status.version !== build.version || status.commit !== build.commit) {
        reasons.push(`${label} did not build as planned.`);
      }
      if (status.tier !== "green") reasons.push(`${label} is reviewed ${status.tier ?? "nothing"}, not green.`);
      for (const note of status.notes ?? []) reasons.push(`${label}: ${note}`);
    }
  }
  return reasons;
}

export async function approve({ repo, number, headSha, plan, statuses, request = api }) {
  if (!Number.isSafeInteger(number) || number <= 0) return { approved: false, reasons: ["no pull request number."] };
  const pull = await request(`/repos/${repo}/pulls/${number}`);
  if (pull.status !== 200) throw new Error(`pull request #${number} answered ${pull.status}.`);
  const files = await all(request, `/repos/${repo}/pulls/${number}/files`);
  const reasons = reasonsAgainst({ pull: pull.body, headSha, files, plan, statuses });
  if (reasons.length > 0) return { approved: false, reasons };
  const reviews = await all(request, `/repos/${repo}/pulls/${number}/reviews`);
  if (reviews.some((review) => review.user?.login === BOT && review.state === "APPROVED" && review.commit_id === headSha)) {
    return { approved: true, reasons: [], already: true };
  }
  const versions = plan.builds.map((build) => `\`${build.name}\` ${build.version}`).join("、");
  const body = [
    `🟢 自动批准：${versions} 是协作者对自己已上架插件的更新，和上一版比是绿档，没有换密钥、换仓库或其他要人看的变化。新的推送会撤销这个批准。`,
    "",
    `Approved automatically: ${versions} is a collaborator's update of their own listed plugin, green against the last listed version, with no key, repository or other change a maintainer must look at. A new push dismisses this approval.`,
  ].join("\n");
  const result = await request(`/repos/${repo}/pulls/${number}/reviews`, { method: "POST", body: { commit_id: headSha, event: "APPROVE", body } });
  if (result.status !== 200) throw new Error(`approving #${number} answered ${result.status}.`);
  return { approved: true, reasons: [] };
}

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { plan: { type: "string" }, builds: { type: "string" }, "pr-file": { type: "string" }, "head-sha": { type: "string" } } });
  if (!values.plan || !values.builds || !values["pr-file"] || !values["head-sha"] || !process.env.GITHUB_REPOSITORY) {
    console.error("Usage: node scripts/v3/approve.mjs --plan <plan.json> --builds <dir> --pr-file <pr.json> --head-sha <sha>; GITHUB_REPOSITORY and GITHUB_TOKEN set.");
    process.exit(2);
  }
  const plan = readJson(values.plan);
  const statuses = Object.fromEntries((plan?.builds ?? []).map((build) => [build.id, readJson(path.join(values.builds, build.id, "status.json"))]));
  const result = await approve({
    repo: process.env.GITHUB_REPOSITORY,
    number: Number(readJson(values["pr-file"])?.number),
    headSha: values["head-sha"],
    plan,
    statuses,
  });
  if (result.approved) console.log(result.already ? "Already approved for this commit." : "Approved.");
  else console.log(`Left for a maintainer:\n${result.reasons.map((reason) => `  - ${reason}`).join("\n")}`);
}
