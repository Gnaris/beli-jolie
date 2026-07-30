import { chromium } from "playwright";

const URL = "https://microstore.app/s/wuu9t";

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  locale: "fr-FR",
});
const page = await context.newPage();

const apiCalls = [];
page.on("response", async (resp) => {
  const u = resp.url();
  if (u.includes("/api/") || u.includes("imageTransfer")) {
    let body = "";
    try {
      const ct = resp.headers()["content-type"] || "";
      if (ct.includes("json")) body = (await resp.text()).slice(0, 4000);
    } catch {}
    apiCalls.push({ status: resp.status(), url: u, body });
  }
});

await page.goto(URL, { waitUntil: "networkidle", timeout: 45000 });
await page.waitForTimeout(3000);

const title = await page.title();
const finalUrl = page.url();
const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 8000);

const imgs = await page.evaluate(() =>
  Array.from(document.images).slice(0, 40).map((i) => ({
    src: i.currentSrc || i.src,
    alt: i.alt,
    w: i.naturalWidth,
    h: i.naturalHeight,
  }))
);

const buttons = await page.evaluate(() =>
  Array.from(document.querySelectorAll("button, a[href], [role=button]"))
    .slice(0, 60)
    .map((b) => (b.innerText || b.textContent || "").trim())
    .filter(Boolean)
);

await page.screenshot({ path: "C:/Users/Admin/Downloads/microstore-screenshot.png", fullPage: true });

console.log("=== TITLE ===");
console.log(title);
console.log("\n=== FINAL URL ===");
console.log(finalUrl);
console.log("\n=== BODY TEXT (extrait) ===");
console.log(bodyText);
console.log("\n=== IMAGES (première ", imgs.length, ") ===");
console.log(JSON.stringify(imgs, null, 2));
console.log("\n=== BOUTONS/LIENS ===");
console.log(JSON.stringify(buttons, null, 2));
console.log("\n=== API CALLS ===");
console.log(JSON.stringify(apiCalls, null, 2));

await browser.close();
