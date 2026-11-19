import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { MAX_KEYWORDS, docHashes, keywordsOf, manifestSummary } from "../../scripts/v3/lib/listing.mjs";
import { tempDir } from "./helpers.mjs";

const sha = (text) => createHash("sha256").update(text).digest("hex");
const built = (extra = {}) => ({ license: "MIT", fuyu: { displayName: { "zh-CN": "天气", en: "Weather" }, description: { "zh-CN": "看天气", en: "Weather" } }, ...extra });

test("the manifest summary carries the package's keywords, cleaned, and leaves the field out when there are none", () => {
  assert.deepEqual(manifestSummary(built({ keywords: [" 天气预报 ", "forecast", "Forecast", "", 7, "rain"] })).keywords, ["天气预报", "forecast", "rain"]);
  assert.equal("keywords" in manifestSummary(built()), false);
  assert.equal("keywords" in manifestSummary(built({ keywords: "weather" })), false);
  assert.equal(keywordsOf({ keywords: Array.from({ length: 50 }, (_, i) => `k${i}`) }).length, MAX_KEYWORDS);
});

test("document hashes cover the README and CHANGELOG files at the top of the package and nothing else", () => {
  const dir = tempDir();
  mkdirSync(path.join(dir, "dist"));
  mkdirSync(path.join(dir, "README.de.md"));
  const files = { "README.md": "# Weather\n", "README.zh-CN.md": "# 天气\r\n", "CHANGELOG.md": "## 1.0.0\n", "LICENSE": "MIT", "package.json": "{}", "NOTES.md": "x", "README.txt": "x" };
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  writeFileSync(path.join(dir, "dist", "README.md"), "nested");
  assert.deepEqual(docHashes(dir), { "CHANGELOG.md": sha("## 1.0.0\n"), "README.md": sha("# Weather\n"), "README.zh-CN.md": sha("# 天气\r\n") });
  assert.deepEqual(docHashes(tempDir()), {});
});
