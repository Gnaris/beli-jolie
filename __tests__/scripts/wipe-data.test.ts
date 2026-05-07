/**
 * Tests unitaires du script `scripts/wipe-data.ts`.
 *
 * On NE lance PAS le script entier (trop destructif) : on importe les
 * fonctions exportees et on les exerce avec un Prisma + un fs simules.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

import {
  TABLES_TO_CLEAR,
  KEEP_TABLES,
  UPLOAD_DIRS,
  validateTableLists,
  databaseNameFromUrl,
  emptyDirectory,
  purgeDatabase,
  purgeUploads,
  countBeforeWipe,
  type PrismaLike,
} from "@/scripts/wipe-data";

// ---------------------------------------------
// Fake Prisma
// ---------------------------------------------

function makeFakePrisma(opts: {
  admin?: { id: string; email: string; kbisPath: string | null } | null;
  countByTable?: Record<string, number>;
  failTruncate?: Set<string>;
  failDeleteUsers?: boolean;
} = {}) {
  const calls: string[] = [];
  const truncated: string[] = [];
  const fkChecks: Array<0 | 1> = [];
  const userDeleteWhere: Array<Record<string, unknown>> = [];

  const prisma: PrismaLike = {
    user: {
      findFirst: vi.fn(async (args: { where: { role: string } }) => {
        calls.push(`user.findFirst:${JSON.stringify(args)}`);
        return opts.admin ?? null;
      }),
      deleteMany: vi.fn(async (args: { where: Record<string, unknown> }) => {
        calls.push(`user.deleteMany:${JSON.stringify(args)}`);
        userDeleteWhere.push(args.where);
        if (opts.failDeleteUsers) throw new Error("simulated user delete failure");
        return { count: 5 };
      }),
      count: vi.fn(async (args?: { where?: Record<string, unknown> }) => {
        const role = (args?.where as { role?: string } | undefined)?.role;
        if (role === "ADMIN") return 1;
        if (role === "CLIENT") return 5;
        return 6;
      }),
    },
    $executeRawUnsafe: vi.fn(async (sql: string) => {
      calls.push(`exec:${sql}`);
      if (sql === "SET FOREIGN_KEY_CHECKS = 0") {
        fkChecks.push(0);
        return 1;
      }
      if (sql === "SET FOREIGN_KEY_CHECKS = 1") {
        fkChecks.push(1);
        return 1;
      }
      const m = /^TRUNCATE TABLE `(.+)`$/.exec(sql);
      if (m) {
        const tbl = m[1];
        if (opts.failTruncate?.has(tbl)) {
          throw new Error(`simulated TRUNCATE failure on ${tbl}`);
        }
        truncated.push(tbl);
        return 1;
      }
      return 1;
    }),
    $queryRawUnsafe: vi.fn(async (sql: string) => {
      calls.push(`query:${sql}`);
      const m = /SELECT COUNT\(\*\) AS c FROM `(.+)`/.exec(sql);
      if (m) {
        const tbl = m[1];
        const n = opts.countByTable?.[tbl] ?? 0;
        return [{ c: n }];
      }
      return [];
    }),
    $disconnect: vi.fn(async () => undefined),
  };

  return { prisma, calls, truncated, fkChecks, userDeleteWhere };
}

// ---------------------------------------------
// validateTableLists
// ---------------------------------------------

describe("validateTableLists", () => {
  it("returns no conflicts on the default lists", () => {
    expect(validateTableLists()).toEqual([]);
  });

  it("flags User if accidentally added to clear list", () => {
    expect(validateTableLists(["User", "Product"])).toContain("User");
  });

  it("flags SiteConfig if accidentally added to clear list", () => {
    expect(validateTableLists(["SiteConfig"])).toContain("SiteConfig");
  });

  it("flags TranslationQuota if accidentally added to clear list", () => {
    expect(validateTableLists(["TranslationQuota"], ["TranslationQuota"])).toContain(
      "TranslationQuota",
    );
  });
});

// ---------------------------------------------
// Topological order sanity
// ---------------------------------------------

describe("TABLES_TO_CLEAR ordering", () => {
  it("places child tables before their parents", () => {
    const idx = (t: string) => TABLES_TO_CLEAR.indexOf(t);
    const pairs: Array<[string, string]> = [
      ["OrderItemModification", "OrderItem"],
      ["OrderItem", "Order"],
      ["ClaimItem", "Claim"],
      ["ClaimImage", "Claim"],
      ["ClaimReturn", "Claim"],
      ["ClaimReship", "Claim"],
      ["MessageAttachment", "Message"],
      ["Message", "Conversation"],
      ["CartItem", "Cart"],
      ["CatalogProduct", "Catalog"],
      ["CollectionProduct", "Collection"],
      ["CollectionTranslation", "Collection"],
      ["PromotionUsage", "Promotion"],
      ["PromotionProduct", "Promotion"],
      ["PromotionCategory", "Promotion"],
      ["PromotionCollection", "Promotion"],
      ["CreditUsage", "Credit"],
      ["PackColorLineSize", "PackColorLine"],
      ["PackColorLine", "ProductColor"],
      ["VariantSize", "ProductColor"],
      ["ProductColorImage", "ProductColor"],
      ["ProductColor", "Product"],
      ["ProductTag", "Product"],
      ["ProductTranslation", "Product"],
      ["ProductComposition", "Product"],
      ["ProductBundle", "Product"],
      ["ProductSimilar", "Product"],
      ["_ProductSubCategories", "Product"],
      ["ProductTag", "Tag"],
      ["TagTranslation", "Tag"],
      ["CompositionTranslation", "Composition"],
      ["SeasonTranslation", "Season"],
      ["ManufacturingCountryTranslation", "ManufacturingCountry"],
      ["ColorTranslation", "Color"],
      ["SubCategoryTranslation", "SubCategory"],
      ["SubCategory", "Category"],
      ["CategoryTranslation", "Category"],
      ["LegalDocumentVersion", "LegalDocument"],
    ];
    for (const [child, parent] of pairs) {
      const ci = idx(child);
      const pi = idx(parent);
      expect(ci, `${child} not in TABLES_TO_CLEAR`).toBeGreaterThanOrEqual(0);
      expect(pi, `${parent} not in TABLES_TO_CLEAR`).toBeGreaterThanOrEqual(0);
      expect(ci, `${child} should come before ${parent}`).toBeLessThan(pi);
    }
  });

  it("does not include User or any KEEP_TABLES entry", () => {
    expect(TABLES_TO_CLEAR).not.toContain("User");
    for (const k of KEEP_TABLES) {
      expect(TABLES_TO_CLEAR).not.toContain(k);
    }
  });
});

// ---------------------------------------------
// databaseNameFromUrl
// ---------------------------------------------

describe("databaseNameFromUrl", () => {
  it("extracts the db name from a full mysql url", () => {
    expect(databaseNameFromUrl("mysql://user:pass@localhost:3306/beliandjolie")).toBe("beliandjolie");
  });

  it("extracts the db name when query string is present", () => {
    expect(databaseNameFromUrl("mysql://u:p@h:3306/mydb?ssl=true&pool=5")).toBe("mydb");
  });

  it("returns null when url is undefined", () => {
    expect(databaseNameFromUrl(undefined)).toBeNull();
  });

  it("returns null when url has no db segment", () => {
    expect(databaseNameFromUrl("mysql://user:pass@host")).toBeNull();
  });
});

// ---------------------------------------------
// purgeDatabase
// ---------------------------------------------

describe("purgeDatabase", () => {
  it("never deletes the admin user -- only deleteMany on role != ADMIN", async () => {
    const { prisma, userDeleteWhere } = makeFakePrisma({
      admin: { id: "adm1", email: "admin@x.com", kbisPath: null },
    });

    const res = await purgeDatabase(prisma);

    expect(res.preservedAdminId).toBe("adm1");
    expect(userDeleteWhere).toHaveLength(1);
    const where = userDeleteWhere[0] as { role?: { not?: string } };
    expect(where.role?.not).toBe("ADMIN");
  });

  it("never truncates SiteConfig nor User nor TranslationQuota", async () => {
    const { prisma, truncated } = makeFakePrisma({
      admin: { id: "adm1", email: "a@x.com", kbisPath: null },
    });
    await purgeDatabase(prisma);
    expect(truncated).not.toContain("SiteConfig");
    expect(truncated).not.toContain("User");
    expect(truncated).not.toContain("TranslationQuota");
  });

  it("truncates every business table once", async () => {
    const { prisma, truncated } = makeFakePrisma({
      admin: { id: "adm1", email: "a@x.com", kbisPath: null },
    });
    await purgeDatabase(prisma);
    for (const t of TABLES_TO_CLEAR) {
      expect(truncated, `expected ${t} to be truncated`).toContain(t);
    }
  });

  it("disables FK checks before truncating and re-enables them afterwards", async () => {
    const { prisma, fkChecks } = makeFakePrisma({
      admin: { id: "adm1", email: "a@x.com", kbisPath: null },
    });
    await purgeDatabase(prisma);
    expect(fkChecks[0]).toBe(0);
    expect(fkChecks[fkChecks.length - 1]).toBe(1);
  });

  it("re-enables FK checks even when a TRUNCATE fails", async () => {
    const ctx = makeFakePrisma({
      admin: { id: "adm1", email: "a@x.com", kbisPath: null },
      failTruncate: new Set(["Product"]),
    });
    const res = await purgeDatabase(ctx.prisma);
    expect(ctx.fkChecks[ctx.fkChecks.length - 1]).toBe(1);
    expect(res.failedTables.some((f) => f.table === "Product")).toBe(true);
  });

  it("returns the kbisPath of the admin so the caller can preserve it", async () => {
    const { prisma } = makeFakePrisma({
      admin: { id: "adm1", email: "a@x.com", kbisPath: "private/uploads/kbis/admin.pdf" },
    });
    const res = await purgeDatabase(prisma);
    expect(res.preservedKbisPath).toBe("private/uploads/kbis/admin.pdf");
  });

  it("logs a warning when no admin exists, but still empties the tables", async () => {
    const { prisma, truncated } = makeFakePrisma({ admin: null });
    const logs: string[] = [];
    const res = await purgeDatabase(prisma, (m) => logs.push(m));
    expect(res.preservedAdminId).toBeNull();
    expect(logs.some((l) => l.toLowerCase().includes("aucun compte admin"))).toBe(true);
    expect(truncated.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------
// countBeforeWipe
// ---------------------------------------------

describe("countBeforeWipe", () => {
  it("queries one COUNT(*) per business table and reports User counts", async () => {
    const { prisma } = makeFakePrisma({
      countByTable: { Product: 78000, Order: 1234, OrderItem: 9876 },
    });
    const report = await countBeforeWipe(prisma);
    expect(report["Product"]).toBe(78000);
    expect(report["Order"]).toBe(1234);
    expect(report["OrderItem"]).toBe(9876);
    expect(report["User (CLIENT a supprimer)"]).toBe(5);
    expect(report["User (ADMIN conserves)"]).toBe(1);
  });
});

// ---------------------------------------------
// emptyDirectory
// ---------------------------------------------

function makeFakeFs(initial: Record<string, "file" | "dir">) {
  const tree = new Map<string, "file" | "dir">();
  for (const [k, v] of Object.entries(initial)) tree.set(path.resolve(k), v);

  const stat = vi.fn(async (p: string) => {
    const v = tree.get(path.resolve(p));
    if (!v) {
      const err: NodeJS.ErrnoException = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    }
    return {
      isDirectory: () => v === "dir",
      isFile: () => v === "file",
    };
  });

  const readdir = vi.fn(async (p: string) => {
    const abs = path.resolve(p);
    const prefix = abs + path.sep;
    const direct: Array<{ name: string; type: "file" | "dir" }> = [];
    for (const [k, v] of tree) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      if (rest.includes(path.sep)) continue;
      direct.push({ name: rest, type: v });
    }
    return direct.map((d) => ({
      name: d.name,
      isDirectory: () => d.type === "dir",
      isFile: () => d.type === "file",
    }));
  });

  const rm = vi.fn(async (p: string) => {
    const abs = path.resolve(p);
    for (const k of [...tree.keys()]) {
      if (k === abs || k.startsWith(abs + path.sep)) tree.delete(k);
    }
  });

  const mkdir = vi.fn(async (p: string) => {
    tree.set(path.resolve(p), "dir");
    return undefined;
  });

  return { tree, stat, readdir, rm, mkdir };
}

describe("emptyDirectory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("removes every file inside the directory but keeps the directory itself", async () => {
    const root = path.resolve("/fake/uploads");
    const fakeFs = makeFakeFs({
      [root]: "dir",
      [`${root}${path.sep}a.webp`]: "file",
      [`${root}${path.sep}b.webp`]: "file",
      [`${root}${path.sep}sub`]: "dir",
      [`${root}${path.sep}sub${path.sep}x.webp`]: "file",
    });
    // typage volontairement simplifie : on passe un fs minimal compatible
    const r = await emptyDirectory(root, null, fakeFs as unknown as Parameters<typeof emptyDirectory>[2]);
    expect(r.deletedFiles).toBe(2);
    expect(r.deletedDirs).toBe(1);
    expect(fakeFs.tree.has(root)).toBe(true);
    expect(fakeFs.tree.has(`${root}${path.sep}a.webp`)).toBe(false);
    expect(fakeFs.tree.has(`${root}${path.sep}sub`)).toBe(false);
  });

  it("preserves the requested file but deletes every other entry", async () => {
    const root = path.resolve("/fake/kbis");
    const keep = `${root}${path.sep}admin.pdf`;
    const fakeFs = makeFakeFs({
      [root]: "dir",
      [keep]: "file",
      [`${root}${path.sep}old.pdf`]: "file",
      [`${root}${path.sep}junk.tmp`]: "file",
    });
    const r = await emptyDirectory(root, keep, fakeFs as unknown as Parameters<typeof emptyDirectory>[2]);
    expect(r.deletedFiles).toBe(2);
    expect(fakeFs.tree.has(keep)).toBe(true);
    expect(fakeFs.tree.has(`${root}${path.sep}old.pdf`)).toBe(false);
  });

  it("creates the directory if it does not exist (skipped=true)", async () => {
    const root = path.resolve("/does-not-exist/yet");
    const fakeFs = makeFakeFs({});
    const r = await emptyDirectory(root, null, fakeFs as unknown as Parameters<typeof emptyDirectory>[2]);
    expect(r.skipped).toBe(true);
    expect(fakeFs.mkdir).toHaveBeenCalledWith(root, { recursive: true });
  });
});

// ---------------------------------------------
// purgeUploads
// ---------------------------------------------

describe("purgeUploads", () => {
  it("processes every UPLOAD_DIRS entry under the given cwd", async () => {
    const cwd = path.resolve("/fake/project");
    const tree: Record<string, "file" | "dir"> = {
      [path.resolve(cwd, "public/uploads/produits")]: "dir",
      [path.resolve(cwd, "public/uploads/produits/img1.webp")]: "file",
      [path.resolve(cwd, "public/uploads/produits/img2.webp")]: "file",
    };
    const fakeFs = makeFakeFs(tree);

    const res = await purgeUploads({
      cwd,
      preserveFile: null,
      fsImpl: {
        stat: fakeFs.stat,
        readdir: fakeFs.readdir,
        rm: fakeFs.rm,
        mkdir: fakeFs.mkdir,
      } as unknown as Parameters<typeof purgeUploads>[0] extends { fsImpl?: infer F } ? F : never,
    });
    expect(res.perDir).toHaveLength(UPLOAD_DIRS.length);

    const produits = res.perDir.find((d) => d.dir === "public/uploads/produits");
    expect(produits?.deletedFiles).toBe(2);
    expect(produits?.skipped).toBe(false);

    const skippedCount = res.perDir.filter((d) => d.skipped).length;
    expect(skippedCount).toBe(UPLOAD_DIRS.length - 1);
  });

  it("preserves the admin kbis file across the wipe", async () => {
    const cwd = path.resolve("/fake/project");
    const adminKbis = path.resolve(cwd, "private/uploads/kbis/admin.pdf");
    const tree: Record<string, "file" | "dir"> = {
      [path.resolve(cwd, "private/uploads/kbis")]: "dir",
      [adminKbis]: "file",
      [path.resolve(cwd, "private/uploads/kbis/another.pdf")]: "file",
    };
    const fakeFs = makeFakeFs(tree);

    const res = await purgeUploads({
      cwd,
      preserveFile: adminKbis,
      fsImpl: {
        stat: fakeFs.stat,
        readdir: fakeFs.readdir,
        rm: fakeFs.rm,
        mkdir: fakeFs.mkdir,
      } as unknown as Parameters<typeof purgeUploads>[0] extends { fsImpl?: infer F } ? F : never,
    });

    expect(fakeFs.tree.has(adminKbis)).toBe(true);
    expect(fakeFs.tree.has(path.resolve(cwd, "private/uploads/kbis/another.pdf"))).toBe(false);
    expect(res.preservedFiles).toContain(adminKbis);
  });

  it("does not touch any directory outside UPLOAD_DIRS", async () => {
    const cwd = path.resolve("/fake/project");
    const stranger = path.resolve(cwd, "src/secret/config.json");
    const tree: Record<string, "file" | "dir"> = {
      [path.resolve(cwd, "src")]: "dir",
      [path.resolve(cwd, "src/secret")]: "dir",
      [stranger]: "file",
    };
    const fakeFs = makeFakeFs(tree);

    await purgeUploads({
      cwd,
      preserveFile: null,
      fsImpl: {
        stat: fakeFs.stat,
        readdir: fakeFs.readdir,
        rm: fakeFs.rm,
        mkdir: fakeFs.mkdir,
      } as unknown as Parameters<typeof purgeUploads>[0] extends { fsImpl?: infer F } ? F : never,
    });

    expect(fakeFs.tree.has(stranger)).toBe(true);
  });
});
