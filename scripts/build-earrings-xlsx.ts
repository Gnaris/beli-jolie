import ExcelJS from "exceljs";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

interface Row {
  reference: string;
  img: string;
  nameProposed: string;
  descriptionProposed: string;
  subCategoryProposed: string;
  keywords: string;
  anomaly: string;
}

async function main() {
  const dataPath = process.argv[2];
  const outPath = process.argv[3];
  const imagesRoot = process.argv[4];
  if (!dataPath || !outPath || !imagesRoot) {
    console.error("Usage: tsx build-earrings-xlsx.ts <data.json> <out.xlsx> <imagesRoot>");
    process.exit(1);
  }

  const rows: Row[] = JSON.parse(fs.readFileSync(dataPath, "utf8"));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Boucles d'oreilles", {
    views: [{ state: "frozen", ySplit: 1, xSplit: 1, zoomScale: 85 }],
  });

  ws.columns = [
    { header: "Réf.", key: "ref", width: 10 },
    { header: "Image", key: "img", width: 55 },
    { header: "Nom proposé", key: "nameProp", width: 38 },
    { header: "Description proposée", key: "desc", width: 44 },
    { header: "Sous-catégorie proposée", key: "subcat", width: 22 },
    { header: "CORRECTION (à remplir)", key: "correction", width: 22 },
    { header: "Mots-clés", key: "keywords", width: 22 },
    { header: "Anomalie", key: "anomaly", width: 32 },
  ];

  const header = ws.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  header.height = 36;
  header.eachCell((cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    cell.border = { bottom: { style: "medium", color: { argb: "FF0F172A" } } };
  });

  const IMG_PX = 360;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const excelRow = ws.addRow({
      ref: row.reference,
      img: "",
      nameProp: row.nameProposed,
      desc: row.descriptionProposed,
      subcat: row.subCategoryProposed,
      correction: "",
      keywords: row.keywords,
      anomaly: row.anomaly,
    });
    excelRow.height = IMG_PX * 0.78;
    excelRow.alignment = { vertical: "middle", wrapText: true };

    if (row.anomaly) {
      excelRow.getCell("anomaly").fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFEF3C7" },
      };
      excelRow.getCell("anomaly").font = { color: { argb: "FF92400E" }, bold: true };
    }

    const correctionCell = excelRow.getCell("correction");
    correctionCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFECFCCB" },
    };

    const refCell = excelRow.getCell("ref");
    refCell.font = { bold: true };
    refCell.alignment = { vertical: "middle", horizontal: "center" };

    try {
      const webpAbs = path.join(imagesRoot, row.img);
      if (fs.existsSync(webpAbs)) {
        const pngBuf = await sharp(webpAbs).resize(IMG_PX, IMG_PX, { fit: "contain", background: "#ffffff" }).png().toBuffer();
        const imgId = wb.addImage({ buffer: pngBuf as unknown as ArrayBuffer, extension: "png" });
        const rowIdx = excelRow.number;
        ws.addImage(imgId, {
          tl: { col: 1 + 0.05, row: rowIdx - 1 + 0.05 } as unknown as ExcelJS.Anchor,
          ext: { width: IMG_PX, height: IMG_PX },
          editAs: "oneCell",
        });
      } else {
        excelRow.getCell("img").value = `(image absente : ${row.img})`;
      }
    } catch (err) {
      excelRow.getCell("img").value = `(erreur image : ${(err as Error).message})`;
    }
  }

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: rows.length + 1, column: ws.columns.length } };
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

  await wb.xlsx.writeFile(outPath);
  console.log(`Excel écrit : ${outPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
