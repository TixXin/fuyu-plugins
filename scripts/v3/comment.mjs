// Posts the v3 report on a pull request, or updates the one posted before.
//
//   node scripts/v3/comment.mjs --body <comment.md> --pr <number> [--head-sha <sha>]
//
// GITHUB_TOKEN needs pull-requests: write. For a pull request from a fork the
// report comes from the "Comment the v3 report" workflow, which reads it from the
// check run's artifact: the number and text are the fork's to choose, so the
// comment goes only to the pull request whose head is the commit that was
// checked, and a pull request that changes the market's own scripts or
// workflows is flagged, because its report came from its own code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { api } from "../lib/github.mjs";

export const MARKER = "<!-- fuyu-market-v3-report -->";
const SUBMISSION_PATHS = /^(plugins|themes)\//;
const BOT = "github-actions[bot]";

export async function all(request, url) {
  const items = [];
  for (let page = 1; page <= 30; page += 1) {
    const { status, body } = await request(`${url}${url.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    if (status !== 200 || !Array.isArray(body)) throw new Error(`GET ${url} answered ${status}.`);
    items.push(...body);
    if (body.length < 100) break;
  }
  return items;
}

export async function postReport({ repo, number, headSha, body, request = api }) {
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error("no pull request number.");
  if (!body.startsWith(MARKER)) throw new Error("the report does not start with the v3 marker.");
  const pull = await request(`/repos/${repo}/pulls/${number}`);
  if (pull.status !== 200) throw new Error(`pull request #${number} answered ${pull.status}.`);
  if (headSha && pull.body.head?.sha !== headSha) return { skipped: `#${number}'s head is ${pull.body.head?.sha}, not the checked ${headSha}.` };
  if (pull.body.state !== "open") return { skipped: `#${number} is ${pull.body.state}.` };
  const files = await all(request, `/repos/${repo}/pulls/${number}/files`);
  const outside = files.map((file) => file.filename).filter((name) => !SUBMISSION_PATHS.test(name));
  const warning = outside.length
    ? `> ⚠️ 这个 PR 还改了 ${outside.slice(0, 5).map((name) => `\`${name}\``).join("、")}${outside.length > 5 ? ` 等 ${outside.length} 个文件` : ""}：下面的报告由 PR 自己的代码生成，不能当作市场的结论。 / This pull request also changes files outside plugins/ and themes/, so the report below was made by its own code and proves nothing.\n\n`
    : "";
  const text = body.replace(MARKER, `${MARKER}\n${warning}`.trimEnd() + "\n");
  const comments = await all(request, `/repos/${repo}/issues/${number}/comments`);
  const mine = comments.find((comment) => comment.user?.login === BOT && comment.body?.startsWith(MARKER));
  const result = mine
    ? await request(`/repos/${repo}/issues/comments/${mine.id}`, { method: "PATCH", body: { body: text } })
    : await request(`/repos/${repo}/issues/${number}/comments`, { method: "POST", body: { body: text } });
  if (![200, 201].includes(result.status)) throw new Error(`writing the comment answered ${result.status}.`);
  return { url: result.body?.html_url ?? null, updated: Boolean(mine) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { body: { type: "string" }, pr: { type: "string" }, "pr-file": { type: "string" }, "head-sha": { type: "string" } } });
  const fromFile = values["pr-file"] ? JSON.parse(readFileSync(values["pr-file"], "utf8")) : {};
  const number = Number(values.pr ?? fromFile.number);
  if (!values.body || !process.env.GITHUB_REPOSITORY) {
    console.error("Usage: node scripts/v3/comment.mjs --body <comment.md> (--pr <number> | --pr-file <pr.json>) [--head-sha <sha>]; GITHUB_REPOSITORY and GITHUB_TOKEN set.");
    process.exit(2);
  }
  if (fromFile.comment === false) {
    console.log("Nothing to report on this pull request.");
    process.exit(0);
  }
  const result = await postReport({ repo: process.env.GITHUB_REPOSITORY, number, headSha: values["head-sha"] ?? null, body: readFileSync(values.body, "utf8") });
  console.log(result.skipped ? `Not commented: ${result.skipped}` : `${result.updated ? "Updated" : "Posted"} ${result.url}`);
}
