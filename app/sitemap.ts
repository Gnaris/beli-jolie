import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXTAUTH_URL || "https://example.com";

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/produits`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${baseUrl}/categories`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${baseUrl}/collections`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
  ];

  // Dynamic product pages (78k products — batch for performance)
  const products = await prisma.product.findMany({
    where: { status: "ONLINE" },
    select: { id: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 50000, // Google sitemap limit per file
  });

  const productPages: MetadataRoute.Sitemap = products.map((p) => ({
    url: `${baseUrl}/produits/${p.id}`,
    lastModified: p.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  // Collection pages
  const collections = await prisma.collection.findMany({
    select: { id: true, updatedAt: true },
  });

  const collectionPages: MetadataRoute.Sitemap = collections.map((c) => ({
    url: `${baseUrl}/collections/${c.id}`,
    lastModified: c.updatedAt,
    changeFrequency: "weekly" as const,
    priority: 0.6,
  }));

  return [...staticPages, ...productPages, ...collectionPages];
}
