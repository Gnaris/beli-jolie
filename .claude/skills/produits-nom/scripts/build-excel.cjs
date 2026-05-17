/* eslint-disable */
/**
 * Construit le fichier Excel de propositions à partir d'un payload JSON.
 *
 * Usage :
 *   node build-excel.cjs <payload.json>
 *
 * Le payload :
 * {
 *   "imagesDir": "C:/Users/chenb/Desktop/beli-images-temp",
 *   "outputPath": "C:/Users/chenb/Desktop/noms-produits-2026-05-17-lot1.xlsx",
 *   "products": [
 *     {
 *       "reference": "A322",
 *       "names": ["...", "...", "...", "...", "..."],
 *       "descs": ["...", "...", "...", "...", "..."]
 *     }
 *   ]
 * }
 *
 * Chaque produit doit avoir une image WebP nommée `<reference-lowercase>.webp` dans imagesDir.
 *
 * Le script nécessite que node_modules du projet contienne `exceljs` et `sharp`.
 * Comme le skill vit dans le projet, ces dépendances sont déjà disponibles.
 */

const path = require("path");
const fs = require("fs");

// Résoudre les modules depuis la racine du projet (skill vit dans .claude/skills/produits-nom/scripts/)
const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
require("module").Module._initPaths();
const projectNodeModules = path.join(PROJECT_ROOT, "node_modules");
module.paths.unshift(projectNodeModules);

const ExcelJS = require(path.join(projectNodeModules, "exceljs"));
const sharp = require(path.join(projectNodeModules, "sharp"));

const IMG_DISPLAY_PX = 320;
const IMG_SOURCE_PX = 640;
const COL_IMG_WIDTH = 47;
const ROW_HEIGHT = 245;
const COL_NAME = 13;
const COL_DESC = 16;
const COL_CHOICE = 9;
const COL_COMMENT = 16;

const HEADER_FILL = "FFEFEFEF";
const NAME_BLOCK_FILL = "FFFFF8E1";
const DESC_BLOCK_FILL = "FFE3F2FD";
const CHOICE_FILL = "FFC8E6C9";
const COMMENT_FILL = "FFFFE0B2";

(async () => {
  const payloadPath = process.argv[2];
  if (!payloadPath) {
    console.error("Usage: node build-excel.cjs <payload.json>");
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf-8"));
  const { imagesDir, outputPath, products } = payload;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Beli & Jolie";
  wb.created = new Date();
  const ws = wb.addWorksheet("Propositions", {
    views: [{ state: "frozen", xSplit: 2, ySplit: 1 }],
  });

  ws.columns = [
    { header: "Réf.", key: "ref", width: 7 },
    { header: "Image", key: "img", width: COL_IMG_WIDTH },
    { header: "Nom 1", key: "n1", width: COL_NAME },
    { header: "Nom 2", key: "n2", width: COL_NAME },
    { header: "Nom 3", key: "n3", width: COL_NAME },
    { header: "Nom 4", key: "n4", width: COL_NAME },
    { header: "Nom 5", key: "n5", width: COL_NAME },
    { header: "Choix nom", key: "cn", width: COL_CHOICE },
    { header: "Commentaire nom", key: "kn", width: COL_COMMENT },
    { header: "Desc. 1", key: "d1", width: COL_DESC },
    { header: "Desc. 2", key: "d2", width: COL_DESC },
    { header: "Desc. 3", key: "d3", width: COL_DESC },
    { header: "Desc. 4", key: "d4", width: COL_DESC },
    { header: "Desc. 5", key: "d5", width: COL_DESC },
    { header: "Choix desc.", key: "cd", width: COL_CHOICE },
    { header: "Commentaire desc.", key: "kd", width: COL_COMMENT },
  ];

  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 48;
  headerRow.eachCell((cell, col) => {
    let fill = HEADER_FILL;
    if (col >= 3 && col <= 7) fill = NAME_BLOCK_FILL;
    else if (col === 8) fill = CHOICE_FILL;
    else if (col === 9) fill = COMMENT_FILL;
    else if (col >= 10 && col <= 14) fill = DESC_BLOCK_FILL;
    else if (col === 15) fill = CHOICE_FILL;
    else if (col === 16) fill = COMMENT_FILL;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
    cell.border = {
      top: { style: "thin", color: { argb: "FF999999" } },
      left: { style: "thin", color: { argb: "FF999999" } },
      bottom: { style: "thin", color: { argb: "FF999999" } },
      right: { style: "thin", color: { argb: "FF999999" } },
    };
  });

  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    const webpPath = path.join(imagesDir, p.reference.toLowerCase() + ".webp");
    if (!fs.existsSync(webpPath)) {
      console.warn(`⚠️  Image manquante pour ${p.reference} : ${webpPath}`);
      continue;
    }
    const jpegBuf = await sharp(webpPath)
      .resize(IMG_SOURCE_PX, IMG_SOURCE_PX, {
        fit: "contain",
        kernel: "lanczos3",
        background: { r: 255, g: 255, b: 255 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 95, chromaSubsampling: "4:4:4" })
      .toBuffer();
    const imageId = wb.addImage({ buffer: jpegBuf, extension: "jpeg" });

    const row = ws.addRow({
      ref: p.reference,
      img: "",
      n1: p.names[0],
      n2: p.names[1],
      n3: p.names[2],
      n4: p.names[3],
      n5: p.names[4],
      cn: "",
      kn: "",
      d1: p.descs[0],
      d2: p.descs[1],
      d3: p.descs[2],
      d4: p.descs[3],
      d5: p.descs[4],
      cd: "",
      kd: "",
    });
    row.height = ROW_HEIGHT;
    row.alignment = { vertical: "middle", wrapText: true };
    row.eachCell((cell, col) => {
      let fill = null;
      if (col === 1) fill = HEADER_FILL;
      else if (col >= 3 && col <= 7) fill = NAME_BLOCK_FILL;
      else if (col === 8) fill = CHOICE_FILL;
      else if (col === 9) fill = COMMENT_FILL;
      else if (col >= 10 && col <= 14) fill = DESC_BLOCK_FILL;
      else if (col === 15) fill = CHOICE_FILL;
      else if (col === 16) fill = COMMENT_FILL;
      if (fill) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.border = {
        top: { style: "thin", color: { argb: "FFCCCCCC" } },
        left: { style: "thin", color: { argb: "FFCCCCCC" } },
        bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        right: { style: "thin", color: { argb: "FFCCCCCC" } },
      };
      cell.alignment = { vertical: "middle", wrapText: true };
      if (col === 1) {
        cell.font = { bold: true, size: 11 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      }
    });

    ws.addImage(imageId, {
      tl: { col: 1.08, row: row.number - 1 + 0.05 },
      ext: { width: IMG_DISPLAY_PX, height: IMG_DISPLAY_PX },
    });

    ws.getCell(`H${row.number}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"1,2,3,4,5,Aucun"'],
      showErrorMessage: true,
      errorTitle: "Choix invalide",
      error: "Choisir 1, 2, 3, 4, 5 ou Aucun.",
    };
    ws.getCell(`H${row.number}`).alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    ws.getCell(`H${row.number}`).font = { bold: true };

    ws.getCell(`O${row.number}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"1,2,3,4,5,Aucun"'],
      showErrorMessage: true,
      errorTitle: "Choix invalide",
      error: "Choisir 1, 2, 3, 4, 5 ou Aucun.",
    };
    ws.getCell(`O${row.number}`).alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    ws.getCell(`O${row.number}`).font = { bold: true };
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await wb.xlsx.writeFile(outputPath);
  console.log("OK -> " + outputPath);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
