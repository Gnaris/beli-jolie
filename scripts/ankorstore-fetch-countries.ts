import { prisma } from "@/lib/prisma";
import { tenantALS } from "@/lib/tenant-als";
import { boGet } from "@/lib/ankorstore-bo/client";

async function main() {
  const t = await prisma.tenant.findFirst({ where: { slug: "beli-jolie" }, select: { id: true } });
  if (!t) throw new Error("tenant");
  await tenantALS.run(t.id, async () => {
    const res = await boGet<{ countries: Array<{ id: number; name: string; iso_code: string }> }>(
      "/api/countries"
    );
    const wanted = ["FR", "CN", "IN", "IT", "ES", "DE", "PT", "TR", "MA", "TN", "BE", "NL", "PL",
      "GB", "US", "JP", "KR", "VN", "TH", "MX", "BR", "ID", "BD", "PK", "PE", "EG", "GR", "IE",
      "CH", "AT", "DK", "SE", "NO", "FI", "CZ", "RO", "BG", "HU", "SK", "HR", "RS", "LV", "LT",
      "EE", "SI", "LU", "MT", "CY", "IS", "AU", "NZ", "CA", "AR", "CL", "CO", "ZA"];
    console.log("export const ANKORSTORE_COUNTRY_ISO_TO_ID: Record<string, number> = {");
    for (const iso of wanted) {
      const c = res.countries.find((x) => x.iso_code === iso);
      if (c) console.log(`  ${iso}: ${c.id}, // ${c.name}`);
    }
    console.log("};");
  });
}
main().catch(console.error).finally(() => prisma.$disconnect());
