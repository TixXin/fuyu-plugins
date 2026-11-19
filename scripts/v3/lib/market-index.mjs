// Assembling and signing index.v3.json (format: docs/architecture/plugins/v3-market.md
// in TixXin/fuyu). The submissions say what is listed; build results (address,
// hash, publish time) carry over from the previous index, so a listed version
// never changes; only "urgent" follows what the maintainers currently say.
import { generateKeyPairSync } from "node:crypto";
import { listedBundles } from "./bundles.mjs";
import { loadMarket } from "./tools.mjs";
import { OFFICIAL_REPOSITORY, compareVersions, isOfficialName, ownerOf, parseName } from "./submission.mjs";

const market = await loadMarket();

export const LIFETIME_DAYS = market.INDEX_LIFETIME_DAYS;
const DAY_MS = 24 * 60 * 60 * 1000;
const TAG_PART = /^[a-z0-9._+-]+$/;

export const isoSeconds = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

/** The release tag of one version: "v3.someone.weather@1.2.0". The scope has no dots and nothing else has an "@", so tags never collide. */
export function releaseTag(name, version, prefix = "v3") {
  const parsed = parseName(name);
  if (!parsed || !TAG_PART.test(version) || !/^[a-z0-9-]+$/.test(prefix)) throw new Error(`no release tag for ${name} ${version}.`);
  return `${prefix}.${parsed.scope}.${parsed.name}@${version}`;
}

export const downloadUrl = (repo, tag, file) => `https://github.com/${repo}/releases/download/${tag}/${file}`;

/** One "versions" entry of the index from a build listing and where its files were published. */
export function versionEntry(listing, { repo, tag, publishedAt, reviewedAt }) {
  const url = (file) => downloadUrl(repo, tag, file);
  return {
    version: listing.version,
    repository: listing.repository,
    commit: listing.commit,
    engines: listing.engines,
    platforms: listing.platforms,
    url: url(listing.file),
    sha256: listing.sha256,
    size: listing.size,
    publishedAt,
    reviewedAt: reviewedAt ?? listing.reviewedAt ?? publishedAt,
    ...(listing.urgent ? { urgent: listing.urgent } : {}),
    ...(listing.authorSignature ? { authorSignature: listing.authorSignature } : {}),
    manifest: listing.manifest,
    icon: { url: url(listing.icon.file), sha256: listing.icon.sha256 },
    ...(listing.screenshots?.length
      ? { screenshots: listing.screenshots.map((shot) => ({ url: url(shot.file), sha256: shot.sha256, ...(shot.caption ? { caption: shot.caption } : {}) })) }
      : {}),
    ...(listing.docs && Object.keys(listing.docs).length > 0 ? { docs: listing.docs } : {}),
  };
}

/**
 * index.v3.json from the submissions (each already valid), the previous index and
 * the versions released in this run (Map "name@version" → entry). Versions that
 * are neither are left out and returned in `pending`. `bundles` are the bundle
 * files ({ file, text }); one with a problem is left out and reported in
 * `bundleProblems`, and with none listed the index has no "bundles" at all.
 * Throws when the result does not pass the island's own validation.
 */
export function assembleIndex({ submissions, previous = null, released = new Map(), now = Date.now(), revokedSerial = null, bundles = [] }) {
  const before = new Map((previous?.plugins ?? []).map((plugin) => [plugin.name, plugin]));
  const plugins = [];
  const pending = [];
  for (const submission of [...submissions].sort((left, right) => left.name.localeCompare(right.name))) {
    const listed = new Map((before.get(submission.name)?.versions ?? []).map((entry) => [entry.version, entry]));
    const versions = [];
    for (const line of submission.versions) {
      const found = released.get(`${submission.name}@${line.version}`) ?? listed.get(line.version);
      if (!found) {
        pending.push(`${submission.name}@${line.version}`);
        continue;
      }
      if (found.commit !== line.commit || found.repository !== line.repository) {
        throw new Error(`${submission.name} ${line.version} is listed from ${found.repository}@${found.commit}, but submitted as ${line.repository}@${line.commit}.`);
      }
      const { urgent, ...rest } = found;
      versions.push({ ...rest, ...(line.urgent ? { urgent: line.urgent } : {}) });
    }
    if (versions.length === 0) continue;
    versions.sort((left, right) => compareVersions(right.version, left.version));
    const official = isOfficialName(submission.name);
    plugins.push({
      name: submission.name,
      publisher: { github: ownerOf(official ? OFFICIAL_REPOSITORY : versions[0].repository), official },
      authorKeys: official ? [] : submission.authorKeys,
      versions,
    });
  }
  const chosen = listedBundles(bundles, new Set(plugins.map((plugin) => plugin.name)));
  const doc = {
    format: market.FORMAT,
    serial: Math.max(Math.floor(now / 1000), (previous?.serial ?? 0) + 1),
    generatedAt: isoSeconds(now),
    expires: isoSeconds(now + LIFETIME_DAYS * DAY_MS),
    ...(revokedSerial == null ? {} : { revokedSerial }),
    plugins,
    ...(chosen.bundles.length > 0 ? { bundles: chosen.bundles } : {}),
  };
  const problems = market.validateIndex(doc);
  if (problems.length > 0) throw new Error(`the assembled index is not valid:\n${problems.map((item) => `${item.path} ${item.message}`).join("\n")}`);
  return { doc, pending, bundleProblems: chosen.problems };
}

export const indexText = (doc) => `${JSON.stringify(doc, null, 2)}\n`;
export const signatureText = (signature) => `${JSON.stringify(signature, null, 2)}\n`;

/**
 * Signs index text with `privateKey` and opens it again as the island would.
 * Refuses a key that is not an index key of `trust`, or a result the island would
 * not take (an older serial than `lastSerial`, an invalid document).
 */
export function signIndex(text, privateKey, trust, { lastSerial = null, now = Date.now() } = {}) {
  const { keyId } = market.publicKeyOf(privateKey);
  if (trust.revocation.some((key) => key.keyId === keyId)) throw new Error(`key ${keyId} is a revocation key; it must never sign the index.`);
  if (!trust.index.some((key) => key.keyId === keyId)) throw new Error(`key ${keyId} is not an index key in keys/trusted.v3.json; the island would refuse the index.`);
  const signature = market.signText(text, privateKey);
  const opened = market.openIndex({ text, signature, trust, lastSerial, now });
  if (opened.status !== "ok") {
    const detail = opened.problems?.map((item) => `${item.path} ${item.message}`).join("; ");
    throw new Error(`the signed index does not open as the island opens it (${opened.status}${opened.reason ? `: ${opened.reason}` : ""}${detail ? `: ${detail}` : ""}).`);
  }
  return { signature, keyId, doc: opened.doc };
}

/** A throwaway key and a trust root holding only it, for rehearsals: nothing it signs is trusted by any island. */
export function ephemeralTrust() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, trust: { index: [market.publicKeyOf(privateKey)], revocation: [] } };
}
