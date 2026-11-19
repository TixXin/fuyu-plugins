// Puts a pull request's v3 results together: the plan's problems and notes, each
// version's build and review, and a rehearsal of the index (assembled from what
// was built, signed with a throwaway key and opened as the island opens it).
//
//   node scripts/v3/report.mjs --plan <dir> --builds <dir> --out <dir> [--pr <number>] [--head-sha <sha>]
//
// Writes <out>/comment.md, <out>/pr.json ({ number, headSha, comment }) and appends
// the report to the job summary. Exits 1 when the pull request cannot be merged as is.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { MARKER } from "./comment.mjs";
import { bundleFiles } from "./lib/bundles.mjs";
import { INDEX_FILE } from "./lib/documents.mjs";
import { assembleIndex, ephemeralTrust, indexText, releaseTag, signIndex, versionEntry } from "./lib/market-index.mjs";
import { validSubmissions } from "./lib/submission.mjs";
import { ROOT } from "./lib/tools.mjs";

const MAX_COMMENT = 60000;
const TIER = { green: "🟢", yellow: "🟡", red: "🔴" };
const short = (commit) => commit.slice(0, 12);

const readJson = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null);

function sourceLink(repository, commit, folder) {
  return `${repository}/tree/${commit}${folder ? `/${folder}` : ""}`;
}

function versionSection(build, status, listing, review) {
  const tier = status?.tier ? `${TIER[status.tier]} ` : "";
  const lines = [`### ${tier}\`${build.name}\` ${build.version}`, ""];
  lines.push(`- 源码 / Source: [${build.repository.replace("https://github.com/", "")}@${short(build.commit)}](${sourceLink(build.repository, build.commit, build.path)})`);
  lines.push(
    build.official
      ? "- 作者证明 / Author proof: 官方插件，提交在 TixXin/fuyu 受保护的 main 上 / official, the commit is on TixXin/fuyu's protected main"
      : `- 作者签名 / Author signature: \`${build.authorSignature.keyId}\` ✅`,
  );
  if (build.previous) {
    const sameRepo = build.previous.repository === build.repository;
    const diff = sameRepo ? ` · [差异 / diff](${build.repository}/compare/${build.previous.commit}...${build.commit})` : "";
    lines.push(`- 对比 / Compared with: ${build.previous.version} (\`${short(build.previous.commit)}\`)${diff}`);
  } else {
    lines.push("- 对比 / Compared with: 无，首次上架 / none, first listing");
  }
  if (build.urgent) lines.push(`- ⚡ urgent: ${build.urgent.reason["zh-CN"]} / ${build.urgent.reason.en}`);
  if (listing) lines.push(`- 包 / Package: \`${listing.file}\`, ${listing.size} bytes, sha256 \`${listing.sha256}\``);
  if (!status) lines.push("- ❌ 构建没有完成 / The build did not finish (see the job log).");
  else if (status.error) lines.push("- ❌ 不能上架 / Cannot be listed:", "", "```text", status.error, "```");
  for (const note of status?.notes ?? []) lines.push(`- ${note}`);
  for (const warning of status?.warnings ?? []) lines.push(`- ⚠️ ${warning}`);
  if (review) lines.push("", review.trim());
  return lines.join("\n");
}

/** Assembles the index the merge would produce and signs it with a throwaway key. */
export function rehearseIndex(root, listings, { now = Date.now(), repo = "TixXin/fuyu-plugins" } = {}) {
  const previous = readJson(path.join(root, INDEX_FILE));
  const publishedAt = new Date(now).toISOString().replace(/\.\d{3}Z$/, "Z");
  const released = new Map(
    listings.map((listing) => [`${listing.name}@${listing.version}`, versionEntry(listing, { repo, tag: releaseTag(listing.name, listing.version), publishedAt, reviewedAt: publishedAt })]),
  );
  const { doc, pending } = assembleIndex({ submissions: validSubmissions(root), previous, released, now, bundles: bundleFiles(root) });
  const { privateKey, trust } = ephemeralTrust();
  const { keyId } = signIndex(indexText(doc), privateKey, trust, { lastSerial: previous?.serial ?? null, now });
  return { keyId, plugins: doc.plugins.length, versions: doc.plugins.reduce((sum, plugin) => sum + plugin.versions.length, 0), pending };
}

export function buildReport({ plan, buildsDir, root = ROOT, now = Date.now() }) {
  const sections = [];
  let ok = plan.errors.length === 0;
  const listings = [];
  for (const build of plan.builds) {
    const dir = path.join(buildsDir, build.id);
    const status = readJson(path.join(dir, "status.json"));
    const listing = readJson(path.join(dir, "listing.json"));
    const review = existsSync(path.join(dir, "report.md")) ? readFileSync(path.join(dir, "report.md"), "utf8") : null;
    if (!status?.ok) ok = false;
    if (listing) listings.push(listing);
    sections.push(versionSection(build, status, listing, review));
  }
  let rehearsal = null;
  if (plan.builds.length > 0 && ok) {
    try {
      const result = rehearseIndex(root, listings, { now });
      rehearsal = `✅ 演练 / Rehearsal: 合入后的 \`index.v3.json\` 能组装（${result.plugins} 个插件、${result.versions} 个版本），用临时密钥 \`${result.keyId}\` 签名后按岛屿的规则打开通过 / the index this merge would produce assembles, and a throwaway key's signature opens as the island opens it.`;
    } catch (error) {
      ok = false;
      rehearsal = `❌ 演练 / Rehearsal: ${error.message}`;
    }
  }
  const hasContent = plan.builds.length > 0 || plan.errors.length > 0 || plan.notes.length > 0;
  const lines = [MARKER, "## 插件市场第 3 版 / Plugin market v3", ""];
  if (!hasContent) lines.push("这个 PR 没有第 3 版的提交 / No v3 submission in this pull request.");
  else {
    lines.push(
      ok ? "✅ **检查通过，等维护者审核** / Checks passed; a maintainer reviews every version before approving." : "❌ **要修改** / Needs changes.",
      "",
      `工具 / Tools: [TixXin/fuyu@${short(plan.tools)}](https://github.com/TixXin/fuyu/tree/${plan.tools}/packages) · 构建设置 / build settings: \`market/v3/build-config.json\``,
    );
    if (plan.errors.length > 0) lines.push("", "### 问题 / Problems", "", ...plan.errors.map((error) => `- ${error}`));
    if (plan.notes.length > 0) {
      lines.push("", "### 变化 / Changes", "");
      for (const note of plan.notes) lines.push(`**\`${note.name}\`**`, "", ...note.lines.map((line) => `- ${line}`), "");
    }
    if (rehearsal) lines.push("", rehearsal);
    for (const section of sections) lines.push("", section);
  }
  let body = `${lines.join("\n").trim()}\n`;
  if (body.length > MAX_COMMENT) body = `${body.slice(0, MAX_COMMENT)}\n\n…（太长，完整报告见运行摘要 / truncated; the full report is in the run summary）\n`;
  return { ok, body, comment: hasContent, full: `${lines.join("\n").trim()}\n` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { values } = parseArgs({ options: { plan: { type: "string" }, builds: { type: "string" }, out: { type: "string" }, pr: { type: "string" }, "head-sha": { type: "string" } } });
  if (!values.plan || !values.builds || !values.out) {
    console.error("Usage: node scripts/v3/report.mjs --plan <dir> --builds <dir> --out <dir> [--pr <number>] [--head-sha <sha>]");
    process.exit(2);
  }
  const planFile = path.join(values.plan, "plan.json");
  const plan = readJson(planFile) ?? { tools: "0".repeat(40), errors: [`${planFile} is missing: the plan job failed (see its log).`], notes: [], builds: [] };
  const report = buildReport({ plan, buildsDir: path.resolve(values.builds) });
  mkdirSync(values.out, { recursive: true });
  writeFileSync(path.join(values.out, "comment.md"), report.body);
  writeFileSync(path.join(values.out, "pr.json"), `${JSON.stringify({ number: Number(values.pr) || null, headSha: values["head-sha"] ?? null, comment: report.comment, ok: report.ok })}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report.full);
  console.log(report.full);
  if (!report.ok) process.exitCode = 1;
}
