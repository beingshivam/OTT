/**
 * One place that knows how to get a browser.
 *
 * Three scripts render HTML to PNG — the OG card, the weekly posters, the
 * launch carousel — and each had its own copy of the same import-and-explain
 * dance. They have now also all hit the same wall, so the workaround belongs
 * somewhere they share rather than three times over.
 *
 * Playwright stays out of package.json on purpose: it downloads a browser, and
 * these run weekly at most.
 */

/**
 * Where an already-installed Chromium lives, if there is one.
 *
 * Playwright pins an exact Chromium revision per release and refuses to start
 * against a different one, which is correct for testing — a screenshot that
 * only reproduces on one build is worthless — and unhelpful here, where the
 * output is a poster and any recent Chromium renders it identically.
 *
 * So: CHROMIUM_PATH points at a binary and we use it as-is. That covers a CI
 * image or sandbox with a browser baked in at some other revision, and a
 * laptop that already has Chrome and would rather not download a second one:
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium npm run social
 *   CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run og
 *
 * Unset, nothing changes: Playwright uses the browser it installed for itself.
 */
const CHROMIUM_PATH = process.env.CHROMIUM_PATH;

export async function launchChromium(script) {
  const { chromium } = await import('playwright').catch(() => {
    console.error(
      'Needs Playwright, which is not a dependency on purpose — it pulls down a\n' +
        'browser and this runs weekly at most:\n\n' +
        `  npm i --no-save playwright && npx playwright install chromium && npm run ${script}\n\n` +
        'Already have a Chromium or Chrome somewhere? Skip the download:\n\n' +
        `  CHROMIUM_PATH=/path/to/chrome npm run ${script}\n`,
    );
    process.exit(1);
  });

  return chromium.launch(CHROMIUM_PATH ? { executablePath: CHROMIUM_PATH } : {});
}
