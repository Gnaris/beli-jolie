import { pfsListProducts } from "./lib/pfs-api";
import { getPfsToken } from "./lib/pfs-auth";

async function main() {
  const res = await pfsListProducts(1, 2);
  const token = await getPfsToken();
  
  for (const p of res.data) {
    console.log("Product:", p.reference);
    if (!p.images) continue;
    
    for (const [key, urls] of Object.entries(p.images)) {
      const arr = Array.isArray(urls) ? urls : [urls];
      const url = arr[0]?.replace(/\?image_process=.*$/, "");
      if (!url) continue;
      
      console.log("  URL:", url);
      
      // Test 1: No auth (current approach)
      try {
        const r1 = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "image/*",
            "Referer": "https://www.parisfashionshops.com/",
          },
        });
        console.log("  No auth:", r1.status, r1.headers.get("content-type")?.substring(0, 30));
      } catch (e: any) {
        console.log("  No auth: ERROR", e.message?.substring(0, 50));
      }

      // Test 2: With PFS Bearer token
      try {
        const r2 = await fetch(url, {
          headers: {
            "Authorization": `Bearer ${token}`,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "image/*",
          },
        });
        console.log("  With token:", r2.status, r2.headers.get("content-type")?.substring(0, 30));
      } catch (e: any) {
        console.log("  With token: ERROR", e.message?.substring(0, 50));
      }

      // Test 3: With cookie-like approach  
      try {
        const r3 = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9",
            "Referer": "https://wholesaler.parisfashionshops.com/",
            "Origin": "https://wholesaler.parisfashionshops.com",
          },
        });
        console.log("  Wholesaler referer:", r3.status, r3.headers.get("content-type")?.substring(0, 30));
      } catch (e: any) {
        console.log("  Wholesaler referer: ERROR", e.message?.substring(0, 50));
      }
      
      break; // Only test first image per product
    }
  }
}

main().catch(console.error);
