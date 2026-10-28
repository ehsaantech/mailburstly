/**
 * Puts the Google site-verification token into the HTML.
 *
 * Google's OAuth review refuses a home page it cannot prove you own. The
 * three ways to prove it are a DNS TXT record, an HTML file at the root of
 * the domain, or a `<meta name="google-site-verification">` tag on the home
 * page. This script covers the third one: it injects the tag into every page
 * that carries the `<!--google-site-verification-->` placeholder.
 *
 * The token is a build arg, not a secret, so it lives in the compose file /
 * .env rather than in the source. Without it the placeholder is simply
 * removed and the page ships exactly as it is in the repo.
 *
 *   # the built pages (what the Docker build runs)
 *   GOOGLE_SITE_VERIFICATION=abc123... bun run inject:verification
 *
 *   # the sources, to look at it locally
 *   GOOGLE_SITE_VERIFICATION=abc123... bun run inject:verification \
 *     index.html public/landing.html
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const PLACEHOLDER = "<!--google-site-verification-->";
const TOKEN = process.env.GOOGLE_SITE_VERIFICATION?.trim() ?? "";

const META = /<meta\s+name="google-site-verification"[^>]*>/i;

// Run from apps/web (the Dockerfile does), so dist/ is right here.
const targets = process.argv.slice(2);
const files =
  targets.length > 0
    ? targets
    : [
        path.resolve(process.cwd(), "dist/index.html"),
        path.resolve(process.cwd(), "dist/landing.html"),
      ];

for (const file of files) {
  let html: string;

  try {
    html = await readFile(file, "utf8");
  } catch {
    console.log(`skip ${file} — not found`);
    continue;
  }

  const before = html;
  const tag = TOKEN
    ? `<meta name="google-site-verification" content="${TOKEN}" />`
    : "";

  if (html.includes(PLACEHOLDER)) {
    // The placeholder is the source of truth: it is replaced by the tag, or
    // dropped when there is no token.
    html = html.replace(PLACEHOLDER, tag);
  } else if (META.test(html)) {
    // Already injected (a rebuild without a fresh copy of public/): rewrite
    // the tag in place so the token can change without a source edit.
    html = html.replace(META, tag);
  } else if (TOKEN) {
    // No placeholder and no tag — put one in anyway.
    html = html.replace(/<head[^>]*>/i, (head) => `${head}\n    ${tag}`);
  }

  if (html === before) {
    console.log(`skip ${file} — nothing to do`);
    continue;
  }

  await writeFile(file, html, "utf8");
  console.log(
    TOKEN ? `verification tag added to ${file}` : `${file} — no token set`,
  );
}
