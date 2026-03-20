import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { anthropic, estimateAiCost, computeActualCost } from "@/lib/claude";
import fs from "fs";
import path from "path";
import type Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const {
    estimateOnly = false,
    productInfo = {},
    imagePaths = [] as string[],
  } = body;

  // ── Build text context from product info ───────────────────────────
  const lines: string[] = [];
  if (productInfo.categoryName)         lines.push(`Category: ${productInfo.categoryName}`);
  if (productInfo.subCategoryNames?.length) lines.push(`Subcategories: ${productInfo.subCategoryNames.join(", ")}`);
  if (productInfo.tagNames?.length)     lines.push(`Tags/Keywords: ${productInfo.tagNames.join(", ")}`);
  if (productInfo.compositions?.length) {
    lines.push(`Composition: ${productInfo.compositions
      .map((c: { name: string; percentage: number }) => `${c.name} ${c.percentage}%`)
      .join(", ")}`);
  }
  if (productInfo.colors?.length) {
    lines.push(`Colors: ${productInfo.colors
      .map((c: { name: string; hex: string }) => `${c.name} (${c.hex})`)
      .join(", ")}`);
  }
  const dims = productInfo.dimensions ?? {};
  const dimParts: string[] = [];
  if (dims.length)        dimParts.push(`L${dims.length}mm`);
  if (dims.width)         dimParts.push(`W${dims.width}mm`);
  if (dims.height)        dimParts.push(`H${dims.height}mm`);
  if (dims.diameter)      dimParts.push(`Ø${dims.diameter}mm`);
  if (dims.circumference) dimParts.push(`C${dims.circumference}mm`);
  if (dimParts.length)    lines.push(`Dimensions: ${dimParts.join(", ")}`);

  const textContext = lines.join("\n");

  // ── Cost estimate (returned immediately if estimateOnly) ────────────
  const cappedImages = Math.min((imagePaths as string[]).length, 3);
  const estimatedCostUsd = estimateAiCost(textContext.length + 800, cappedImages);

  if (estimateOnly) {
    return NextResponse.json({ estimatedCostUsd });
  }

  // ── Load images from disk (max 3) ───────────────────────────────────
  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  for (const imgPath of (imagePaths as string[]).slice(0, 3)) {
    try {
      const filePath = path.join(process.cwd(), "public", imgPath.replace(/^\//, ""));
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath);
        const b64  = data.toString("base64");
        const ext  = path.extname(imgPath).toLowerCase();
        const mediaType: "image/jpeg" | "image/png" | "image/webp" =
          ext === ".png"  ? "image/png" :
          ext === ".webp" ? "image/webp" : "image/jpeg";
        imageBlocks.push({
          type: "image",
          source: { type: "base64", media_type: mediaType, data: b64 },
        });
      }
    } catch { /* skip unreadable images */ }
  }

  // ── Build prompt (FR only) ──────────────────────────────────────────
  const systemPrompt =
    `You are a B2B jewelry and accessories product copywriter specializing in French. ` +
    `Given product data (and optionally images), generate a commercial product name and a clear, ` +
    `SEO-friendly description in French. ` +
    `The name must be concise (3-8 words). The description must be 2-4 sentences, ` +
    `simple, precise, and highlight key product characteristics (material, colors, dimensions). ` +
    `Output ONLY valid JSON — no markdown, no comments, no extra keys.`;

  const userText =
    `Product information:\n${textContext || "(no additional info provided)"}\n\n` +
    `Return ONLY this JSON structure (fill in real values):\n{\n  "fr": { "name": "...", "description": "..." }\n}`;

  const userContent: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam)[] = [
    ...imageBlocks,
    { type: "text", text: userText },
  ];

  // ── Call Claude ─────────────────────────────────────────────────────
  try {
    const response = await anthropic.messages.create({
      model:      "claude-sonnet-4-6",
      max_tokens: 500,
      system:     systemPrompt,
      messages:   [{ role: "user", content: userContent }],
    });

    // Extract text output and strip possible markdown fences
    const rawText  = response.content.find((b) => b.type === "text")?.text ?? "{}";
    const jsonText = rawText
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    let translations: Record<string, { name: string; description: string }> = {};
    try {
      translations = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        { error: "AI returned invalid JSON", raw: rawText },
        { status: 500 },
      );
    }

    const actualCostUsd = computeActualCost(
      response.usage.input_tokens,
      response.usage.output_tokens,
    );

    return NextResponse.json({
      translations,
      estimatedCostUsd,
      actualCostUsd,
      usage: {
        inputTokens:  response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "AI generation error" },
      { status: 500 },
    );
  }
}
