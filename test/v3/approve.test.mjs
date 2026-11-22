import assert from "node:assert/strict";
import test from "node:test";
import { approve, reasonsAgainst } from "../../scripts/v3/approve.mjs";

const HEAD = "h".repeat(40);
const A = "a".repeat(40);
const B = "b".repeat(40);
const REPO = "https://github.com/Someone/fuyu-plugin";

const pull = (extra = {}) => ({
  state: "open",
  draft: false,
  user: { login: "Someone" },
  author_association: "COLLABORATOR",
  base: { ref: "main", repo: { default_branch: "main" } },
  head: { sha: HEAD },
  ...extra,
});
const build = (extra = {}) => ({
  id: "b0",
  name: "@someone/weather",
  version: "1.1.0",
  repository: REPO,
  commit: B,
  official: false,
  previous: { version: "1.0.0", repository: REPO, commit: A },
  ...extra,
});
const status = (extra = {}) => ({ id: "b0", name: "@someone/weather", version: "1.1.0", commit: B, ok: true, tier: "green", notes: [], warnings: [], ...extra });
const files = [{ filename: "plugins/v3/someone/weather.json", status: "modified" }];
const plan = (extra = {}) => ({ mode: "pr", errors: [], notes: [], builds: [build()], ...extra });
const input = (extra = {}) => ({ pull: pull(), headSha: HEAD, files, plan: plan(), statuses: { b0: status() }, ...extra });

test("a collaborator's green update of their own listed plugin may be approved", () => {
  assert.deepEqual(reasonsAgainst(input()), []);
});

test("anything a maintainer must look at is left for a person", () => {
  const cases = {
    "not a collaborator": input({ pull: pull({ author_association: "CONTRIBUTOR" }) }),
    "a draft": input({ pull: pull({ draft: true }) }),
    "moved head": input({ pull: pull({ head: { sha: "g".repeat(40) } }) }),
    "another branch": input({ pull: pull({ base: { ref: "next", repo: { default_branch: "main" } } }) }),
    "a script too": input({ files: [...files, { filename: "scripts/v3/plan.mjs", status: "modified" }] }),
    "someone else's scope": input({ files: [{ filename: "plugins/v3/other/weather.json", status: "modified" }] }),
    "a new plugin": input({ files: [{ filename: "plugins/v3/someone/weather.json", status: "added" }] }),
    "no files": input({ files: [] }),
    "plan problems": input({ plan: plan({ errors: ["bad"] }) }),
    "a new key": input({ plan: plan({ notes: [{ name: "@someone/weather", lines: ["New author key k1, endorsed by k0."] }] }) }),
    "nothing to build": input({ plan: plan({ builds: [] }) }),
    "no plan": input({ plan: null }),
    "first listing": input({ plan: plan({ builds: [build({ previous: null })] }) }),
    "moved repository": input({ plan: plan({ builds: [build({ previous: { version: "1.0.0", repository: "https://github.com/Someone/other", commit: A } })] }) }),
    "urgent": input({ plan: plan({ builds: [build({ urgent: { reason: { "zh-CN": "急", en: "urgent" } } })] }) }),
    "official": input({ plan: plan({ builds: [build({ official: true })] }) }),
    "another scope's plugin": input({ plan: plan({ builds: [build({ name: "@other/weather" })] }) }),
    "yellow": input({ statuses: { b0: status({ tier: "yellow" }) } }),
    "build failed": input({ statuses: { b0: status({ ok: false }) } }),
    "no build result": input({ statuses: {} }),
    "another commit built": input({ statuses: { b0: status({ commit: A }) } }),
    "previous could not be fetched": input({ statuses: { b0: status({ notes: ["The listed version 1.0.0 could not be fetched."] }) } }),
  };
  for (const [label, value] of Object.entries(cases)) assert.notDeepEqual(reasonsAgainst(value), [], label);
});

function fakeGitHub({ pullBody = pull(), reviews = [] } = {}) {
  const calls = [];
  const request = async (url, { method = "GET", body } = {}) => {
    calls.push({ method, url, body });
    if (url === "/repos/o/r/pulls/7") return { status: 200, body: pullBody };
    if (url.startsWith("/repos/o/r/pulls/7/files")) return { status: 200, body: files };
    if (url.startsWith("/repos/o/r/pulls/7/reviews") && method === "GET") return { status: 200, body: reviews };
    return { status: 200, body: {} };
  };
  return { request, calls };
}

test("the approval is for the checked commit and is not repeated", async () => {
  const fresh = fakeGitHub();
  assert.equal((await approve({ repo: "o/r", number: 7, headSha: HEAD, plan: plan(), statuses: { b0: status() }, request: fresh.request })).approved, true);
  assert.equal(fresh.calls.at(-1).method, "POST");
  assert.equal(fresh.calls.at(-1).body.commit_id, HEAD);
  assert.equal(fresh.calls.at(-1).body.event, "APPROVE");

  const again = fakeGitHub({ reviews: [{ user: { login: "github-actions[bot]" }, state: "APPROVED", commit_id: HEAD }] });
  assert.equal((await approve({ repo: "o/r", number: 7, headSha: HEAD, plan: plan(), statuses: { b0: status() }, request: again.request })).already, true);
  assert.ok(again.calls.every((call) => call.method === "GET"));

  const yellow = fakeGitHub();
  const left = await approve({ repo: "o/r", number: 7, headSha: HEAD, plan: plan(), statuses: { b0: status({ tier: "yellow" }) }, request: yellow.request });
  assert.equal(left.approved, false);
  assert.ok(yellow.calls.every((call) => call.method === "GET"));
});
