/* eslint-disable */
/**
 * Lit un fichier Excel de retour rempli par la cliente et extrait ses choix.
 *
 * Usage :
 *   node parse-xlsx.cjs <fichier.xlsx>
 *
 * Sortie : JSON sur stdout avec 4 catégories :
 *   - validated         : nom ET description choisis (1-5 chacun)
 *   - partial_name_only : nom choisi mais description "Aucun"
 *   - partial_desc_only : description choisie mais nom "Aucun"
 *   - to_revise         : nom ET description "Aucun"
 */

const path = require("path");
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const ExcelJS = require(path.join(PROJECT_ROOT, "node_modules", "exceljs"));

function cellText(v) {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (v.richText) return v.richText.map((r) => r.text).join("");
    if (v.text) return v.text;
    if (v.result !== undefined && v.result !== null) return String(v.result);
  }
  return String(v);
}

function parseChoice(raw) {
  const s = cellText(raw).trim();
  if (!s) return null;
  if (/^[1-5]$/.test(s)) return parseInt(s, 10);
  if (/^aucun$/i.test(s)) return "aucun";
  return null; // valeur inattendue
}

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node parse-xlsx.cjs <fichier.xlsx>");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  if (!ws) {
    console.error("Aucune feuille trouvée.");
    process.exit(1);
  }

  const validated = [];
  const partial_name_only = [];
  const partial_desc_only = [];
  const to_revise = [];

  ws.eachRow({ includeEmpty: false }, (row, rowIdx) => {
    if (rowIdx === 1) return; // header

    const ref = cellText(row.getCell(1).value).trim();
    if (!ref) return;

    const names = [
      cellText(row.getCell(3).value),
      cellText(row.getCell(4).value),
      cellText(row.getCell(5).value),
      cellText(row.getCell(6).value),
      cellText(row.getCell(7).value),
    ];
    const choiceName = parseChoice(row.getCell(8).value);
    const commentName = cellText(row.getCell(9).value).trim();

    const descs = [
      cellText(row.getCell(10).value),
      cellText(row.getCell(11).value),
      cellText(row.getCell(12).value),
      cellText(row.getCell(13).value),
      cellText(row.getCell(14).value),
    ];
    const choiceDesc = parseChoice(row.getCell(15).value);
    const commentDesc = cellText(row.getCell(16).value).trim();

    const nameOk = typeof choiceName === "number";
    const descOk = typeof choiceDesc === "number";
    const nameRevise = choiceName === "aucun" || choiceName === null;
    const descRevise = choiceDesc === "aucun" || choiceDesc === null;

    if (nameOk && descOk) {
      validated.push({
        ref,
        name: names[choiceName - 1],
        description: descs[choiceDesc - 1],
      });
    } else if (nameOk && descRevise) {
      partial_name_only.push({
        ref,
        name: names[choiceName - 1],
        desc_comment: commentDesc,
      });
    } else if (descOk && nameRevise) {
      partial_desc_only.push({
        ref,
        description: descs[choiceDesc - 1],
        name_comment: commentName,
      });
    } else {
      to_revise.push({
        ref,
        name_comment: commentName,
        desc_comment: commentDesc,
      });
    }
  });

  console.log(
    JSON.stringify(
      { validated, partial_name_only, partial_desc_only, to_revise },
      null,
      2,
    ),
  );
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
