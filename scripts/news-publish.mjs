#!/usr/bin/env node
/**
 * Publishes a reviewed news draft — the one step a person takes.
 *
 *   node scripts/news-publish.mjs                # lists drafts waiting
 *   node scripts/news-publish.mjs <slug>         # publishes one
 *   node scripts/news-publish.mjs <slug> --unpublish
 *
 * Also runs from the "Publish article" workflow, so it can be done from the
 * GitHub app on a phone. See news-draft.mjs for why nothing publishes itself.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NEWS_DIR = resolve(ROOT, process.env.NEWS_DIR ?? 'data/news');
const [slug] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const unpublish = process.argv.includes('--unpublish');

if (!slug) {
  const files = (await readdir(NEWS_DIR).catch(() => [])).filter((f) => f.endsWith('.json'));
  const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(resolve(NEWS_DIR, f), 'utf8'))));
  const drafts = all.filter((a) => a.status === 'draft');
  console.log(drafts.length ? 'Drafts waiting for review:' : 'No drafts waiting.');
  for (const d of drafts) console.log(`  ${d.slug}\n    ${d.headline}`);
  process.exit(0);
}

const path = resolve(NEWS_DIR, `${slug}.json`);
const article = JSON.parse(await readFile(path, 'utf8').catch(() => {
  console.error(`No article "${slug}" in data/news. Run without arguments to list drafts.`);
  process.exit(1);
}));

if (unpublish) {
  article.status = 'draft';
} else {
  const now = new Date().toISOString();
  if (article.status === 'published') article.updatedAt = now;
  else article.publishedAt = now;
  article.status = 'published';
  delete article.reviewNotes;
}
await writeFile(path, `${JSON.stringify(article, null, 2)}\n`);
console.log(`${unpublish ? 'Unpublished' : 'Published'}: /news/${slug}`);
