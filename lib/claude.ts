import Anthropic from "@anthropic-ai/sdk";

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY ?? "",
});

// Claude claude-sonnet-4-6 pricing (per million tokens)
const INPUT_COST_PER_MTOK  = 3.0;  // $3.00 / 1M input tokens
const OUTPUT_COST_PER_MTOK = 15.0; // $15.00 / 1M output tokens

/**
 * Rough cost estimate before calling the API.
 * textLength : number of characters in the text prompt
 * imageCount : number of images sent (each ~1 000 tokens at low detail)
 * outputTokens : expected output length in tokens
 */
export function estimateAiCost(
  textLength: number,
  imageCount: number,
  outputTokens = 1_500,
): number {
  const textInputTokens  = Math.ceil(textLength / 4);
  const imageInputTokens = imageCount * 1_000;
  const systemTokens     = 500;
  const totalInput       = textInputTokens + imageInputTokens + systemTokens;

  const inputCost  = (totalInput    / 1_000_000) * INPUT_COST_PER_MTOK;
  const outputCost = (outputTokens  / 1_000_000) * OUTPUT_COST_PER_MTOK;
  return inputCost + outputCost;
}

/**
 * Compute exact cost from API usage response.
 */
export function computeActualCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK
       + (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK;
}
