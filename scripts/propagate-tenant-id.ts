import fs from "node:fs";
import path from "node:path";

const SCHEMA_PATH = path.join(process.cwd(), "prisma", "schema.prisma");

const TARGETS = [
  "ProductTranslation",
  "ProductColor",
  "ProductColorImage",
  "ProductSimilar",
  "ProductBundle",
  "ProductTag",
  "ProductComposition",
  "ProductView",
  "PriceHistory",
  "Cart",
  "CartItem",
  "Visit",
  "PendingSimilar",
  "OrderItem",
  "OrderItemModification",
  "Favorite",
  "ShippingAddress",
  "Claim",
  "ClaimItem",
  "ClaimImage",
  "ClaimReturn",
  "ClaimReship",
  "Credit",
  "CreditUsage",
  "Collection",
  "CollectionTranslation",
  "CollectionProduct",
  "Promotion",
  "PromotionCategory",
  "PromotionCollection",
  "PromotionProduct",
  "PromotionUsage",
  "Catalog",
  "CatalogProduct",
  "ImportJob",
  "ImportDraft",
  "AnkorstoreOperation",
  "MarketplaceRefreshJob",
  "EfashionShootingBatchItem",
  "ImageProcessingJob",
  "TranslationJob",
  "StockMovement",
  "LegalDocument",
  "LegalDocumentVersion",
  "Conversation",
  "Message",
  "MessageAttachment",
  "PasswordResetToken",
  "LoginOtp",
  "LoginAttempt",
  "AccountLockout",
  "RegistrationLog",
  "TranslationQuota",
  "StripeWebhookEvent",
  "VariantSize",
  "PackColorLine",
  "PackColorLineSize",
];

function findModelBlock(source: string, modelName: string): { start: number; end: number } | null {
  const re = new RegExp(`^model\\s+${modelName}\\s*\\{`, "m");
  const match = re.exec(source);
  if (!match) return null;
  const start = match.index;

  let depth = 0;
  let i = start;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

function alreadyHasTenantId(block: string): boolean {
  return /^\s*tenantId\s+String\??/m.test(block);
}

function injectTenantIntoModel(source: string, modelName: string): { source: string; changed: boolean } {
  const block = findModelBlock(source, modelName);
  if (!block) {
    console.warn(`[propagate] Modele introuvable : ${modelName}`);
    return { source, changed: false };
  }
  const modelSource = source.slice(block.start, block.end + 1);
  if (alreadyHasTenantId(modelSource)) {
    return { source, changed: false };
  }

  const lines = modelSource.split("\n");
  let insertLineIdx = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("@@")) {
      insertLineIdx = i;
    } else if (trimmed === "}") {
      if (insertLineIdx === -1) insertLineIdx = i;
    } else if (trimmed.length > 0 && insertLineIdx > 0) {
      break;
    }
  }
  if (insertLineIdx <= 0) insertLineIdx = lines.length - 1;

  const snippet = [
    "",
    "  // Multi-tenant : nullable pendant migration progressive, deviendra NOT NULL apres backfill.",
    "  tenantId String?",
    "  tenant   Tenant? @relation(fields: [tenantId], references: [id])",
    "",
    "  @@index([tenantId])",
  ];

  lines.splice(insertLineIdx, 0, ...snippet);
  const newModel = lines.join("\n");
  return {
    source: source.slice(0, block.start) + newModel + source.slice(block.end + 1),
    changed: true,
  };
}

function ensureBackRelationOnTenant(source: string, modelName: string): { source: string; changed: boolean } {
  const block = findModelBlock(source, "Tenant");
  if (!block) {
    throw new Error("Modele Tenant introuvable dans schema.prisma");
  }
  const modelSource = source.slice(block.start, block.end + 1);
  const rel = `${modelName[0].toLowerCase()}${modelName.slice(1)}s`;
  const re = new RegExp(`^\\s*${rel}\\s+${modelName}\\[\\]`, "m");
  if (re.test(modelSource)) {
    return { source, changed: false };
  }

  const lines = modelSource.split("\n");
  let insertLineIdx = -1;
  for (let i = lines.length - 1; i > 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith("@@")) insertLineIdx = i;
    else if (trimmed === "}") {
      if (insertLineIdx === -1) insertLineIdx = i;
    } else if (trimmed.length > 0 && insertLineIdx > 0) {
      break;
    }
  }
  if (insertLineIdx <= 0) insertLineIdx = lines.length - 1;

  const snippet = `  ${rel.padEnd(24, " ")} ${modelName}[]`;
  lines.splice(insertLineIdx, 0, snippet);
  return {
    source: source.slice(0, block.start) + lines.join("\n") + source.slice(block.end + 1),
    changed: true,
  };
}

function main() {
  let source = fs.readFileSync(SCHEMA_PATH, "utf8");
  const injected: string[] = [];
  const backRelAdded: string[] = [];

  for (const modelName of TARGETS) {
    const r1 = injectTenantIntoModel(source, modelName);
    if (r1.changed) {
      source = r1.source;
      injected.push(modelName);
    }
    const r2 = ensureBackRelationOnTenant(source, modelName);
    if (r2.changed) {
      source = r2.source;
      backRelAdded.push(modelName);
    }
  }

  if (injected.length === 0 && backRelAdded.length === 0) {
    console.log("[propagate] Rien a faire.");
    return;
  }

  fs.writeFileSync(SCHEMA_PATH, source, "utf8");
  console.log(`[propagate] ${injected.length} modeles modifies :`);
  injected.forEach((m) => console.log(`  - ${m}`));
  console.log(`[propagate] ${backRelAdded.length} back-relations ajoutees sur Tenant.`);
}

main();
