import fs from "fs";
import path from "path";
import sharp from "sharp";

const OUTPUT_DIR = path.join(process.cwd(), "public", "uploads", "beliandjolie", "categories");
const STROKE = "#334155";
const SIZE = 512;

const wrap = (inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="${STROKE}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONS: Record<string, string> = {
  "bague-ajustable": `<circle cx="24" cy="30" r="12"/><path d="M18 15 L 24 6 L 30 15 L 24 20 Z"/>`,
  "boucles-d-oreilles": `<circle cx="16" cy="8" r="1.5" fill="${STROKE}" stroke="none"/><path d="M16 10 v6"/><circle cx="16" cy="26" r="8"/><circle cx="32" cy="8" r="1.5" fill="${STROKE}" stroke="none"/><path d="M32 10 v4"/><path d="M32 14 C 26 14 24 24 28 32 C 30 36 34 36 36 32 C 40 24 38 14 32 14 Z"/>`,
  "bracelet": `<ellipse cx="24" cy="22" rx="16" ry="10"/><path d="M24 32 v3"/><path d="M24 42 c-4 -2 -6 -5 -5 -7 c1 -1 3 0 5 2 c2 -2 4 -3 5 -2 c1 2 -1 5 -5 7 z" fill="${STROKE}"/>`,
  "broche": `<circle cx="20" cy="20" r="3"/><circle cx="20" cy="12" r="4"/><circle cx="28" cy="20" r="4"/><circle cx="20" cy="28" r="4"/><circle cx="12" cy="20" r="4"/><path d="M28 28 L 40 40"/><circle cx="40" cy="40" r="1.5" fill="${STROKE}" stroke="none"/>`,
  "chaine-de-cheville": `<ellipse cx="24" cy="20" rx="15" ry="7" stroke-dasharray="1 2"/><path d="M24 27 v4"/><circle cx="24" cy="35" r="3" fill="${STROKE}" stroke="none"/>`,
  "chaine-de-corps": `<path d="M8 8 L 40 40" stroke-dasharray="1.4 2.4"/><path d="M40 8 L 8 40" stroke-dasharray="1.4 2.4"/><circle cx="24" cy="24" r="3" fill="${STROKE}" stroke="none"/><circle cx="8" cy="8" r="1.3" fill="${STROKE}" stroke="none"/><circle cx="40" cy="8" r="1.3" fill="${STROKE}" stroke="none"/><circle cx="8" cy="40" r="1.3" fill="${STROKE}" stroke="none"/><circle cx="40" cy="40" r="1.3" fill="${STROKE}" stroke="none"/>`,
  "chaine-de-taille": `<path d="M4 22 q5 -5 10 0 t10 0 t10 0 t10 0"/><path d="M24 24 v6"/><path d="M20 30 h8 v4 l-4 4 l-4 -4 z" fill="${STROKE}"/>`,
  "collier": `<path d="M8 8 Q 24 32 40 8"/><path d="M24 28 v3"/><path d="M24 40 c-4 -2 -6 -5 -5 -7 c1 -1 3 0 5 2 c2 -2 4 -3 5 -2 c1 2 -1 5 -5 7 z" fill="${STROKE}"/>`,
  "lot-de-bagues-avec-presentoir": `<rect x="4" y="30" width="40" height="8" rx="1.5"/><circle cx="12" cy="22" r="5"/><circle cx="24" cy="22" r="5"/><circle cx="36" cy="22" r="5"/>`,
  "lot-de-bijoux-mixtes-avec-presentoir": `<rect x="4" y="34" width="40" height="8" rx="1.5"/><circle cx="12" cy="26" r="5"/><path d="M20 16 Q 24 26 28 16"/><circle cx="24" cy="22" r="1.5" fill="${STROKE}" stroke="none"/><ellipse cx="36" cy="26" rx="5" ry="3"/>`,
  "lot-de-boucles-d-oreilles-avec-presentoir": `<rect x="10" y="4" width="28" height="40" rx="2"/><path d="M24 4 v40" opacity="0.2"/><circle cx="18" cy="14" r="1.3" fill="${STROKE}" stroke="none"/><circle cx="30" cy="14" r="1.3" fill="${STROKE}" stroke="none"/><path d="M18 15 v3"/><path d="M30 15 v3"/><circle cx="18" cy="22" r="3"/><circle cx="30" cy="22" r="3"/><circle cx="18" cy="30" r="1.3" fill="${STROKE}" stroke="none"/><circle cx="30" cy="30" r="1.3" fill="${STROKE}" stroke="none"/><path d="M18 31 v2"/><path d="M30 31 v2"/><path d="M15 34 h6 l-3 6 z" fill="${STROKE}"/><path d="M27 34 h6 l-3 6 z" fill="${STROKE}"/>`,
  "lot-de-bracelets-avec-presentoir": `<ellipse cx="24" cy="42" rx="10" ry="3"/><path d="M24 42 v-26"/><path d="M14 16 h20"/><ellipse cx="24" cy="22" rx="10" ry="2.5"/><ellipse cx="24" cy="30" rx="10" ry="2.5"/><ellipse cx="24" cy="38" rx="10" ry="2.5"/>`,
  "lot-de-chaines-de-cheville-avec-presentoir": `<rect x="4" y="6" width="40" height="4" rx="1"/><path d="M12 10 v18" stroke-dasharray="0.8 1.4"/><path d="M24 10 v22" stroke-dasharray="0.8 1.4"/><path d="M36 10 v18" stroke-dasharray="0.8 1.4"/><circle cx="12" cy="30" r="1.6" fill="${STROKE}" stroke="none"/><circle cx="24" cy="34" r="1.6" fill="${STROKE}" stroke="none"/><circle cx="36" cy="30" r="1.6" fill="${STROKE}" stroke="none"/><rect x="4" y="38" width="40" height="6" rx="1.5"/>`,
  "lot-de-colliers-avec-presentoir": `<circle cx="24" cy="8" r="4"/><path d="M12 40 v-4 q0 -10 12 -14 q12 4 12 14 v4 z"/><path d="M14 42 h20"/><path d="M16 20 Q 24 32 32 20"/><circle cx="24" cy="27" r="1.4" fill="${STROKE}" stroke="none"/>`,
  "lot-de-parures-de-bijoux-avec-presentoir": `<circle cx="18" cy="8" r="3.5"/><path d="M8 40 v-4 q0 -10 10 -13 q10 3 10 13 v4 z"/><path d="M10 42 h16"/><path d="M12 18 Q 18 26 24 18"/><circle cx="18" cy="24" r="1.3" fill="${STROKE}" stroke="none"/><circle cx="36" cy="12" r="1.2" fill="${STROKE}" stroke="none"/><path d="M36 13 v3"/><circle cx="36" cy="20" r="2.5"/><circle cx="42" cy="12" r="1.2" fill="${STROKE}" stroke="none"/><path d="M42 13 v3"/><path d="M39 16 h6 l-3 5 z" fill="${STROKE}"/>`,
  "chaine-de-lunettes": `<circle cx="14" cy="18" r="7"/><circle cx="34" cy="18" r="7"/><path d="M21 18 h6"/><path d="M7 16 l-3 -1"/><path d="M41 16 l3 -1"/><path d="M8 24 Q 4 34 8 42 Q 24 46 40 42 Q 44 34 40 24" stroke-dasharray="1 1.6"/>`,
  "parure-de-bijoux": `<path d="M6 6 Q 24 24 42 6"/><circle cx="24" cy="16" r="1.6" fill="${STROKE}" stroke="none"/><circle cx="10" cy="26" r="1.2" fill="${STROKE}" stroke="none"/><path d="M10 27 v3"/><circle cx="10" cy="35" r="3"/><circle cx="38" cy="26" r="1.2" fill="${STROKE}" stroke="none"/><path d="M38 27 v3"/><path d="M35 30 h6 l-3 6 z" fill="${STROKE}"/><ellipse cx="24" cy="40" rx="10" ry="3"/>`,
  "pendentif": `<path d="M6 6 Q 24 26 42 6"/><path d="M24 22 v3"/><path d="M24 42 C 18 38 18 32 22 28 C 23 27 25 27 26 28 C 30 32 30 38 24 42 Z" fill="${STROKE}"/>`,
  "piercing": `<circle cx="24" cy="26" r="12"/><circle cx="24" cy="14" r="3" fill="${STROKE}" stroke="none"/>`,
  "porte-cle": `<circle cx="14" cy="24" r="6"/><circle cx="14" cy="24" r="2"/><path d="M20 24 h20"/><path d="M30 24 v4"/><path d="M36 24 v5"/><path d="M40 24 v4"/>`,
  "presentoir": `<circle cx="24" cy="8" r="4"/><path d="M12 40 v-4 q0 -10 12 -14 q12 4 12 14 v4 z"/><path d="M14 42 h20"/>`,
  "pochon": `<path d="M8 14 h32"/><path d="M12 12 v4 M18 12 v3 M24 12 v4 M30 12 v3 M36 12 v4"/><path d="M22 6 L 24 10 L 26 6 L 26 12 L 22 12 Z" fill="${STROKE}"/><path d="M8 14 C 4 26 8 42 24 42 C 40 42 44 26 40 14"/>`,
  "boite": `<rect x="6" y="18" width="36" height="24" rx="1.5"/><rect x="6" y="14" width="36" height="8" rx="1.5"/><path d="M24 14 v28"/><path d="M20 10 C 16 6 12 10 16 14 C 18 12 22 14 24 14 C 26 14 30 12 32 14 C 36 10 32 6 28 10" fill="${STROKE}" fill-opacity="0.15"/>`,
};

async function main() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  for (const [slug, inner] of Object.entries(ICONS)) {
    const svg = wrap(inner);
    const outPath = path.join(OUTPUT_DIR, `${slug}.png`);
    await sharp(Buffer.from(svg), { density: 300 })
      .resize(SIZE, SIZE, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(outPath);
    process.stdout.write(`  ${slug}.png\n`);
  }
  process.stdout.write(`\n${Object.keys(ICONS).length} icones generees dans ${OUTPUT_DIR}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
