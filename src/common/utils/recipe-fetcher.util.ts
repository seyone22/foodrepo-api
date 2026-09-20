import { execFile } from "child_process";
import { chromium } from "playwright";
import { BadRequestException } from "@nestjs/common";

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
  const launchOptions = { headless: true };
  try {
    browser = await chromium.launch({ ...launchOptions, channel: "chrome" });
  } catch {
    try {
      browser = await chromium.launch({ ...launchOptions, channel: "msedge" });
    } catch {
      browser = await chromium.launch(launchOptions);
    }
  }

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    return await page.content();
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
 * Tier 3: Headless Playwright browser instance using system Chrome/Edge.
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
    }
  } catch {
    // Fall through to Tier 2
  }

  // Tier 2: TLS-impersonating system fetcher (curl)
  try {
    const html = await fetchViaCurl(url);
    if (html.length > 500 && !isBotBlockPage(html)) {
      return html;
    }
  } catch {
    // Fall through to Tier 3
  }

  // Tier 3: Playwright headless browser
  try {
    const html = await fetchViaPlaywright(url);
    if (html && html.length > 500 && !isBotBlockPage(html)) {
      return html;
    }
  } catch {
    // All tiers exhausted
  }

  throw new BadRequestException(
    `Could not fetch recipe URL (${url}). The site blocked automated retrieval. Please try pasting the recipe or ingredient list directly in the 'Paste Recipe' tab.`,
  );
}
