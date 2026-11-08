#!/usr/bin/env node
// The release gate on versions. The chat extension (packages/vscode, "jawata-chat") and the Java extension (packages/vscode-java,
// "jawata-java") are released together under ONE tag, so the tag `vX.Y.Z` and both package versions must be the same X.Y.Z.
//   node scripts/release-versions.mjs v0.1.0   the tag run: fails if either package version differs from the tag
//   node scripts/release-versions.mjs          the dry run (no tag): fails if the two package versions differ from each other
// On success it prints the shared version on one line (`version=X.Y.Z`), which the workflow appends to its step outputs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PACKAGES = [['packages/vscode', 'jawata-chat'], ['packages/vscode-java', 'jawata-java']];

/** The version each released package declares, by package name. */
export function declaredVersions(root = ROOT) {
  return Object.fromEntries(PACKAGES.map(([folder, name]) => {
    const manifest = JSON.parse(readFileSync(`${root}/${folder}/package.json`, 'utf8'));
    if (manifest.name !== name) { throw new Error(`${folder}/package.json is named ${manifest.name}, not ${name}`); }
    return [name, manifest.version];
  }));
}

/** What is wrong with these versions and this tag (undefined for a run without a tag); the list is empty when they agree. */
export function problemsWith(versions, tag) {
  const problems = [];
  const distinct = new Set(Object.values(versions));
  if (distinct.size > 1) {
    problems.push(`the two packages are at different versions (${Object.entries(versions).map(([n, v]) => `${n} ${v}`).join(', ')}); they are released together and must be equal`);
  }
  if (tag !== undefined) {
    if (!/^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(tag)) { problems.push(`the tag ${tag} is not v<major>.<minor>.<patch>`); }
    for (const [name, version] of Object.entries(versions)) {
      if (`v${version}` !== tag) { problems.push(`the tag is ${tag} but ${name} is at ${version}`); }
    }
  }
  return problems;
}

function main() {
  const tag = process.argv[2] || undefined;
  const versions = declaredVersions();
  const problems = problemsWith(versions, tag);
  if (problems.length > 0) {
    for (const p of problems) { console.error(`release versions: ${p}`); }
    process.exit(1);
  }
  console.log(`version=${Object.values(versions)[0]}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { main(); }
