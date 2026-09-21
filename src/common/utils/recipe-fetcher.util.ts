import { execFile } from "child_process";
import * as fs from "fs";
import { BadRequestException, Logger } from "@nestjs/common";

// Load playwright-extra with stealth plugin to bypass bot/Cloudflare heuristics
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require("playwright-extra");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stealthPlugin = require("puppeteer-extra-plugin-stealth");
try {
  chromium.use(stealthPlugin());
} catch {
  // stealth plugin already registered
}

const logger = new Logger("RecipeFetcher");

export function isBotBlockPage(html: string): boolean {
  if (!html || html.length < 500) return true;
  const lower = html.slice(0, 4000).toLowerCase();
  return (
    lower.includes("contentlicensing@people.inc") ||
    lower.includes("access denied") ||
    lower.includes("checking your browser") ||
    (lower.includes("cloudflare ray id") && lower.includes("enable cookies")) ||
    (lower.includes("just a moment") && lower.includes("cloudflare")) ||
    (lower.includes("security check") && lower.includes("cloudflare"))
  );
}

function getChromiumExecutablePath(): string | undefined {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    } catch {
      // ignore filesystem check error
    }
  }
  return undefined;
}

function fetchViaCurl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "-sL",
      "--compressed",
      "-A",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "-H",
      "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "-H",
      "Accept-Language: en-US,en;q=0.9",
      "-H",
      'sec-ch-ua: "Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      "-H",
      "sec-ch-ua-mobile: ?0",
      "-H",
      'sec-ch-ua-platform: "Windows"',
      "-H",
      "sec-fetch-dest: document",
      "-H",
      "sec-fetch-mode: navigate",
      "-H",
      "sec-fetch-site: none",
      "-H",
      "sec-fetch-user: ?1",
      "-H",
      "upgrade-insecure-requests: 1",
      "--max-time",
      "15",
      url,
    ];
    execFile("curl", args, { maxBuffer: 25 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      if (!stdout || stdout.length < 200) {
        return reject(new Error("Response too short or empty from curl"));
      }
      resolve(stdout);
    });
  });
}

async function fetchViaPlaywright(url: string): Promise<string> {
  let browser: any = null;
  const execPath = getChromiumExecutablePath();
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-first-run",
    "--no-zygote",
    "--disable-blink-features=AutomationControlled",
  ];

  const baseOptions = {
    headless: true,
    args: launchArgs,
  };

  // Launch strategy based on available environment binaries
  if (execPath) {
    try {
      browser = await chromium.launch({ ...baseOptions, executablePath: execPath });
    } catch (err) {
      logger.warn(`Failed launching chromium at ${execPath}: ${err}`);
    }
  }

  if (!browser) {
    try {
      browser = await chromium.launch({ ...baseOptions, channel: "chrome" });
    } catch {
      try {
        browser = await chromium.launch({ ...baseOptions, channel: "msedge" });
      } catch {
        browser = await chromium.launch(baseOptions);
      }
    }
  }

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    // Abort media/fonts to conserve memory and accelerate page loading in container
    await page.route("**/*", (route: any) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    let content = await page.content();

    // If a challenge interstitial is detected, give it a moment to resolve
    if (isBotBlockPage(content)) {
      try {
        await page.waitForTimeout(4000);
        content = await page.content();
      } catch {
        // proceed with content
      }
    }

    return content;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

/**
 * Robust, resilient multi-tier recipe web page fetcher:
 * Tier 1: Fast direct HTTP fetch with full modern browser headers.
 * Tier 2: TLS-impersonating system curl fetcher (bypasses Cloudflare JA3/JA4 TLS bot blocks such as HTTP 402/403).
 * Tier 3: Stealth Playwright browser instance with Linux container optimizations.
 */
export async function fetchRecipeHtml(url: string): Promise<string> {
  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua":
      '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-site": "none",
    "sec-fetch-user": "?1",
    "upgrade-insecure-requests": "1",
  };

  // Tier 1: Fast direct fetch
  try {
    const res = await fetch(url, { headers: browserHeaders });
    if (res.ok) {
      const html = await res.text();
      if (html.length > 500 && !isBotBlockPage(html)) {
        return html;
      }
    } else {
      logger.warn(`Tier 1 (direct fetch) received HTTP ${res.status} for ${url}`);
    }
  } catch (err: any) {
    logger.warn(`Tier 1 (direct fetch) error for ${url}: ${err.message}`);
  }

  // Tier 2: TLS-impersonating system fetcher (curl)
  try {
    const html = await fetchViaCurl(url);
    if (html.length > 500 && !isBotBlockPage(html)) {
      logger.log(`Tier 2 (curl) succeeded for ${url} (${html.length} bytes)`);
      return html;
    }
    logger.warn(`Tier 2 (curl) returned bot block page for ${url}`);
  } catch (err: any) {
    logger.warn(`Tier 2 (curl) error for ${url}: ${err.message}`);
  }

  // Tier 3: Playwright stealth headless browser
  try {
    const html = await fetchViaPlaywright(url);
    if (html && html.length > 500 && !isBotBlockPage(html)) {
      logger.log(`Tier 3 (Playwright stealth) succeeded for ${url} (${html.length} bytes)`);
      return html;
    }
    logger.warn(`Tier 3 (Playwright) returned bot block or empty page for ${url}`);
  } catch (err: any) {
    logger.error(`Tier 3 (Playwright stealth) error for ${url}: ${err.message}`);
  }

  throw new BadRequestException(
    `Could not fetch recipe URL (${url}). The site blocked automated retrieval. Please try pasting the recipe or ingredient list directly in the 'Paste Recipe' tab.`,
  );
}
