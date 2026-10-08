// Run by Netlify's build command (see netlify.toml) before the site is published.
// Replaces the __BUILD_DATE__ placeholder in index.html's APP_VERSION_DATE with the
// actual date of this deploy, so the version footer in the "ข้อมูล" tab never goes
// stale from a hand-typed date again. Fails the build loudly (non-zero exit) if the
// placeholder is missing, rather than silently shipping a wrong or blank date.
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'public/index.html';
const PLACEHOLDER_PATTERN = /const APP_VERSION_DATE = '__BUILD_DATE__';/;

const html = readFileSync(FILE, 'utf8');
const today = new Date().toISOString().slice(0, 10); // UTC date; good enough for a version label

if (!PLACEHOLDER_PATTERN.test(html)) {
  console.error(
    `stamp-version: __BUILD_DATE__ placeholder not found in ${FILE}.\n` +
    `Did APP_VERSION_DATE get hand-edited back to a literal date? It should read:\n` +
    `  const APP_VERSION_DATE = '__BUILD_DATE__';\n` +
    `Leaving the file untouched and failing the build so this doesn't ship silently wrong.`
  );
  process.exit(1);
}

const stamped = html.replace(PLACEHOLDER_PATTERN, `const APP_VERSION_DATE = '${today}';`);
// VERSION_HISTORY's current (first) entry also carries the placeholder, so its
// history-panel date matches the live footer date instead of showing __BUILD_DATE__.
const stampedAll = stamped.split("date: '__BUILD_DATE__'").join(`date: '${today}'`);

writeFileSync(FILE, stampedAll);
console.log(`stamp-version: APP_VERSION_DATE set to ${today}`);
