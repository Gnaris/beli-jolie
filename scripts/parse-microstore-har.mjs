import fs from "node:fs";

const files = [
  { label: "IMPORT_EN_MASSE", path: "C:/Users/Admin/Downloads/Importation en masse.har" },
  { label: "IMPORT_MANUELLE_1_PRODUIT", path: "C:/Users/Admin/Downloads/Importation manuelle 1 produit.har" },
];

for (const f of files) {
  console.log("\n\n=================================================");
  console.log("== ", f.label);
  console.log("=================================================");
  const har = JSON.parse(fs.readFileSync(f.path, "utf8"));
  const entries = har.log.entries;
  console.log("Total requests:", entries.length);

  const interesting = entries.filter((e) => {
    const u = e.request.url;
    if (!u) return false;
    if (u.includes(".png") || u.includes(".jpg") || u.includes(".css") || u.includes(".woff") || u.includes(".ico")) {
      if (e.request.method === "GET") return false;
    }
    if (u.match(/\.(js|css|woff2?|ttf|svg|ico|map)(\?|$)/)) return false;
    if (u.includes("google-analytics") || u.includes("facebook.com") || u.includes("fbevents")) return false;
    return u.includes("microstore") || u.includes("myfashionwholesaler") || u.includes("efolix") || u.includes("mfw") || u.includes("dcdn") || e.request.method !== "GET";
  });

  console.log("Filtered (API + POST/PUT):", interesting.length);

  for (const e of interesting) {
    const req = e.request;
    const res = e.response;
    const isMultipart = (req.headers || []).some((h) => h.name.toLowerCase() === "content-type" && (h.value || "").includes("multipart"));
    const contentType = (req.headers || []).find((h) => h.name.toLowerCase() === "content-type")?.value || "";
    const auth = (req.headers || []).find((h) => h.name.toLowerCase() === "authorization")?.value || "";
    const cookie = (req.headers || []).find((h) => h.name.toLowerCase() === "cookie")?.value || "";

    console.log("\n---");
    console.log(req.method, req.url);
    console.log("  content-type:", contentType);
    if (auth) console.log("  authorization:", auth.slice(0, 120));
    if (cookie) console.log("  cookie (first 200):", cookie.slice(0, 200));
    if (req.queryString?.length) {
      console.log("  query:", JSON.stringify(req.queryString.map((q) => `${q.name}=${q.value?.slice(0, 80)}`)));
    }
    if (req.postData) {
      const t = req.postData.text || "";
      if (isMultipart) {
        // strip binary
        const cleaned = t.replace(/�+/g, "…").slice(0, 1500);
        console.log("  postData (multipart, first 1500 chars):", cleaned);
      } else {
        console.log("  postData:", t.slice(0, 2000));
      }
    }
    console.log("  → status:", res.status, res.statusText);
    if (res.content && res.content.text) {
      const body = res.content.text.slice(0, 1200);
      console.log("  ← response (first 1200):", body);
    }
  }
}
