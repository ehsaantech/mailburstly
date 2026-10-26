import { chromium, type BrowserContext } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:5199";
const OUT = process.env.OUT_DIR ?? "/tmp/shots";

async function resolveCampaignId(context: BrowserContext): Promise<string> {
  const page = await context.newPage();
  const res = await page.request.get(BASE + "/api/campaigns");
  await page.close();
  if (!res.ok()) return "cmp_1";
  const body = await res.json();
  const items = body?.data?.items ?? [];
  return items[0]?.id ?? "cmp_1";
}

const routes: Array<{ path: string; name: string; fullPage: boolean }> = [
  { path: "/", name: "dashboard", fullPage: true },
  { path: "/campaigns", name: "campaigns", fullPage: true },
  { path: "/campaigns/__ID__", name: "campaign-detail", fullPage: true },
  { path: "/inbox", name: "inbox", fullPage: false },
  { path: "/leads", name: "leads", fullPage: false },
  { path: "/mailboxes", name: "mailboxes", fullPage: true },
  { path: "/analytics", name: "analytics", fullPage: true },
  { path: "/lists", name: "lists", fullPage: true },
  { path: "/settings", name: "settings", fullPage: true },
];

const themes = ["dark", "light"] as const;

const browser = await chromium.launch({ channel: "chrome" });
let failures = 0;

async function login(context: BrowserContext) {
  const page = await context.newPage();
  const response = await page.request.post(BASE + "/api/auth/login", {
    data: { email: "admin\@example.com", password: "change-me-admin-password" },
  });
  await page.close();
  return response.ok();
}

for (const theme of themes) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  await context.addInitScript((value: string) => {
    try {
      localStorage.setItem("mailrung.theme", value);
    } catch {
      /* ignore */
    }
  }, theme);

  const loggedIn = await login(context);
  if (!loggedIn) {
    console.log("WARN [" + theme + "] login failed");
  }
  const campaignId = await resolveCampaignId(context);
  const themeRoutes = routes.map((r) => ({
    ...r,
    path: r.path.replace("__ID__", campaignId),
  }));

  for (const route of themeRoutes) {
    const page = await context.newPage();
    const errors: string[] = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
    });
    page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

    const response = await page.goto(`${BASE}${route.path}`, {
      waitUntil: "networkidle",
    });
    await page.waitForTimeout(350);

    const state = await page.evaluate(() => ({
      root: document.getElementById("root")?.children.length ?? 0,
      dark: document.documentElement.classList.contains("dark"),
      bodyBg: getComputedStyle(document.body).backgroundColor,
      bodyFg: getComputedStyle(document.body).color,
    }));

    await page.screenshot({
      path: `${OUT}/${theme}-${route.name}.png`,
      fullPage: route.fullPage,
    });

    const status = response?.status() ?? 0;
    const themeOk = theme === "dark" ? state.dark : !state.dark;
    const ok = status === 200 && state.root > 0 && errors.length === 0 && themeOk;
    if (!ok) failures++;

    const bits = [
      `http=${status}`,
      `root=${state.root}`,
      `dark=${state.dark}`,
      `bg=${state.bodyBg}`,
    ];
    console.log(
      `${ok ? "PASS" : "FAIL"} [${theme.padEnd(5)}] ${route.path.padEnd(24)} ${bits.join(" ")}${
        errors.length ? `\n  ${errors.join("\n  ")}` : ""
      }`,
    );

    await page.close();
  }

  await context.close();
}

// Contrast sanity check on the light theme: every text token must differ
// enough from its surface to be readable. Rough, but catches a broken palette.
const check = await browser.newContext();
const page = await check.newPage();
await page.addInitScript(() => {
  try {
    localStorage.setItem("mailrung.theme", "light");
  } catch {
    /* ignore */
  }
});
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });

const contrast = await page.evaluate(() => {
  // Colours resolve to oklch() here, so convert to sRGB via a 1x1 canvas
  // rather than trying to parse the string.
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  const toRgb = (color: string): number[] => {
    if (!ctx) return [0, 0, 0];
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0];
  };

  const lum = ([r = 0, g = 0, b = 0]: number[]) => {
    const f = (c: number) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };

  const ratio = (a: number[], b: number[]) => {
    const l1 = lum(a);
    const l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };

  const body = getComputedStyle(document.body);
  const surface = toRgb(body.backgroundColor);
  const fg = toRgb(body.color);

  const mutedEl = document.querySelector(".text-fg-muted");
  const muted = mutedEl ? toRgb(getComputedStyle(mutedEl).color) : fg;

  const subtleEl = document.querySelector(".text-fg-subtle");
  const subtle = subtleEl ? toRgb(getComputedStyle(subtleEl).color) : muted;

  return {
    fgOnSurface: +ratio(fg, surface).toFixed(2),
    mutedOnSurface: +ratio(muted, surface).toFixed(2),
    subtleOnSurface: +ratio(subtle, surface).toFixed(2),
  };
});

console.log(
  `\nlight contrast: body ${contrast.fgOnSurface}:1, muted ${contrast.mutedOnSurface}:1, subtle ${contrast.subtleOnSurface}:1`,
);
if (contrast.fgOnSurface < 7) {
  console.log("  WARN body text below AAA (7:1)");
  failures++;
}
if (contrast.mutedOnSurface < 4.5) {
  console.log("  WARN muted text below AA (4.5:1)");
  failures++;
}
if (contrast.subtleOnSurface < 3) {
  console.log("  WARN subtle text below AA-large / non-text minimum (3:1)");
  failures++;
}

await check.close();
await browser.close();

console.log(
  failures === 0
    ? "\nAll routes rendered cleanly in both themes."
    : `\n${failures} failure(s).`,
);
process.exit(failures === 0 ? 0 : 1);
