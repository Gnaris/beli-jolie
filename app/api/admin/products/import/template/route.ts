import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import * as ExcelJS from "exceljs";

// ── Design tokens ──
const COLORS = {
  dark: "1A1A1A",
  white: "FFFFFF",
  surface: "F7F7F8",
  border: "E5E5E5",
  green: "22C55E",
  greenLight: "DCFCE7",
  amber: "F59E0B",
  amberLight: "FEF3C7",
  blue: "3B82F6",
  blueLight: "DBEAFE",
  grayLight: "F9FAFB",
  grayMed: "6B7280",
  red: "EF4444",
  redLight: "FEE2E2",
};

const FONT_HEADER: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 11,
  bold: true,
  color: { argb: COLORS.white },
};

const FONT_BODY: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 10,
  color: { argb: COLORS.dark },
};

const FONT_MUTED: Partial<ExcelJS.Font> = {
  name: "Calibri",
  size: 10,
  color: { argb: COLORS.grayMed },
  italic: true,
};

const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: COLORS.border } },
  bottom: { style: "thin", color: { argb: COLORS.border } },
  left: { style: "thin", color: { argb: COLORS.border } },
  right: { style: "thin", color: { argb: COLORS.border } },
};

// ── Column definitions ──
interface ColumnDef {
  key: string;
  header: string;
  width: number;
  required: boolean;
  description: string;
  example: string;
}

const COLUMNS: ColumnDef[] = [
  { key: "reference", header: "Référence *", width: 14, required: true, description: "Référence unique du produit", example: "PRD-001" },
  { key: "name", header: "Nom *", width: 28, required: true, description: "Nom du produit (en français)", example: "Produit Étoile" },
  { key: "description", header: "Description", width: 38, required: false, description: "Description du produit", example: "Produit fin avec motif étoile" },
  { key: "category", header: "Catégorie", width: 20, required: false, description: "Doit exister dans la base", example: "Accessoires" },
  { key: "sub_categories", header: "Sous-catégories", width: 22, required: false, description: "Séparées par des virgules", example: "Sautoir,Fin" },
  { key: "color", header: "Couleur *", width: 24, required: true, description: "Multi-couleurs séparées par /", example: "Doré" },
  { key: "sale_type", header: "Type de vente *", width: 15, required: true, description: "UNIT ou PACK", example: "UNIT" },
  { key: "unit_price", header: "Prix unitaire *", width: 15, required: true, description: "Prix HT en euros", example: "12.50" },
  { key: "pack_qty", header: "Qté pack", width: 12, required: false, description: "Requis si PACK", example: "" },
  { key: "stock", header: "Stock *", width: 10, required: true, description: "Quantité en stock", example: "200" },
  { key: "weight_g", header: "Poids (g)", width: 12, required: false, description: "Poids en grammes", example: "30" },
  { key: "is_primary", header: "Primaire", width: 12, required: false, description: "true = variante principale", example: "true" },
  { key: "discount_type", header: "Type remise", width: 15, required: false, description: "PERCENT ou AMOUNT", example: "" },
  { key: "discount_value", header: "Valeur remise", width: 15, required: false, description: "Valeur de la remise", example: "" },
  { key: "size", header: "Taille", width: 10, required: false, description: "Ex: 17, 18", example: "" },
  { key: "tags", header: "Tags", width: 26, required: false, description: "Mots-clés séparés par des virgules", example: "étoile,fin,tendance" },
  { key: "composition", header: "Composition", width: 32, required: false, description: "Matière:% (ex: Coton:85,Polyester:15)", example: "Coton:100" },
  { key: "similar_refs", header: "Réf. similaires", width: 22, required: false, description: "Références produits similaires (virgules)", example: "PRD-002,PRD-003" },
  { key: "pays_fabrication", header: "Pays fabrication", width: 18, required: false, description: "Doit exister dans la base", example: "France" },
  { key: "saison", header: "Saison", width: 16, required: false, description: "Doit exister dans la base", example: "Été 2026" },
  { key: "dimension_length", header: "Longueur (cm)", width: 16, required: false, description: "Longueur en cm", example: "45" },
  { key: "dimension_width", header: "Largeur (cm)", width: 16, required: false, description: "Largeur en cm", example: "2" },
  { key: "dimension_height", header: "Hauteur (cm)", width: 16, required: false, description: "Hauteur en cm", example: "" },
  { key: "dimension_diameter", header: "Diamètre (cm)", width: 16, required: false, description: "Diamètre en cm", example: "6.5" },
  { key: "dimension_circumference", header: "Circonférence (cm)", width: 20, required: false, description: "Circonférence en cm", example: "" },
];

// ── Sample data (20 produits variés) ──
const SAMPLE_DATA = [
  // ─── 1. T-shirt basique : 1 couleur, UNIT, simple ───
  { reference: "TSH-001", name: "T-shirt Essentiel", description: "T-shirt col rond en coton bio, coupe droite", category: "T-shirts", sub_categories: "Basiques", color: "Blanc", sale_type: "UNIT", unit_price: 14.90, pack_qty: "", stock: 500, weight_g: 180, is_primary: "true", discount_type: "", discount_value: "", size: "M", tags: "basique,coton,essentiel", composition: "Coton:100", similar_refs: "TSH-002", pays_fabrication: "Portugal", saison: "Été 2026", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 2. T-shirt premium : 3 couleurs, UNIT + PACK, multi-tailles ───
  { reference: "TSH-002", name: "T-shirt Oversize Urban", description: "T-shirt oversize à épaules tombantes, toucher doux", category: "T-shirts", sub_categories: "Oversize,Streetwear", color: "Noir", sale_type: "UNIT", unit_price: 24.90, pack_qty: "", stock: 300, weight_g: 220, is_primary: "true", discount_type: "", discount_value: "", size: "L", tags: "oversize,streetwear,urban", composition: "Coton:90,Élasthanne:10", similar_refs: "TSH-001", pays_fabrication: "Turquie", saison: "Automne 2026", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "TSH-002", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "PACK", unit_price: 19.90, pack_qty: 6, stock: 50, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "TSH-002", name: "", description: "", category: "", sub_categories: "", color: "Kaki", sale_type: "UNIT", unit_price: 24.90, pack_qty: "", stock: 200, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "M", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "TSH-002", name: "", description: "", category: "", sub_categories: "", color: "Beige", sale_type: "UNIT", unit_price: 24.90, pack_qty: "", stock: 250, weight_g: "", is_primary: "", discount_type: "PERCENT", discount_value: 10, size: "S", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 3. Collier pendentif : UNIT, remise PERCENT ───
  { reference: "COL-001", name: "Collier Lune Dorée", description: "Collier fin avec pendentif croissant de lune, plaqué or 18k", category: "Bijoux", sub_categories: "Colliers,Pendentifs", color: "Doré", sale_type: "UNIT", unit_price: 29.90, pack_qty: "", stock: 150, weight_g: 12, is_primary: "true", discount_type: "PERCENT", discount_value: 15, size: "", tags: "lune,pendentif,plaqué or,élégant", composition: "Laiton:85,Or:15", similar_refs: "COL-002,BRC-001", pays_fabrication: "France", saison: "", dimension_length: 45, dimension_width: "", dimension_height: "", dimension_diameter: 1.5, dimension_circumference: "" },

  // ─── 4. Collier multi-rang : multi-couleurs, UNIT + PACK ───
  { reference: "COL-002", name: "Collier Triple Chaîne", description: "Collier trois rangs superposables, maille fine", category: "Bijoux", sub_categories: "Colliers", color: "Doré/Argenté/Or Rose", sale_type: "UNIT", unit_price: 34.50, pack_qty: "", stock: 80, weight_g: 18, is_primary: "true", discount_type: "", discount_value: "", size: "", tags: "multi-rang,superposable,chaîne", composition: "Acier inoxydable:100", similar_refs: "COL-001", pays_fabrication: "Italie", saison: "Printemps 2026", dimension_length: 42, dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "COL-002", name: "", description: "", category: "", sub_categories: "", color: "Doré/Argenté/Or Rose", sale_type: "PACK", unit_price: 28.00, pack_qty: 6, stock: 20, weight_g: "", is_primary: "", discount_type: "PERCENT", discount_value: 20, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 5. Bracelet jonc : 2 couleurs, UNIT, remise AMOUNT ───
  { reference: "BRC-001", name: "Bracelet Jonc Torsadé", description: "Bracelet jonc fin torsadé, ajustable", category: "Bijoux", sub_categories: "Bracelets", color: "Doré", sale_type: "UNIT", unit_price: 18.90, pack_qty: "", stock: 300, weight_g: 25, is_primary: "true", discount_type: "AMOUNT", discount_value: 3, size: "", tags: "jonc,torsadé,ajustable", composition: "Laiton:90,Or:10", similar_refs: "COL-001,COL-002", pays_fabrication: "France", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: 6.5, dimension_circumference: "" },
  { reference: "BRC-001", name: "", description: "", category: "", sub_categories: "", color: "Argenté", sale_type: "UNIT", unit_price: 18.90, pack_qty: "", stock: 200, weight_g: "", is_primary: "", discount_type: "AMOUNT", discount_value: 3, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 6. Pantalon chino : UNIT, plusieurs couleurs ───
  { reference: "PNT-001", name: "Chino Classique Slim", description: "Pantalon chino coupe slim, taille mi-haute", category: "Pantalons", sub_categories: "Chinos", color: "Beige", sale_type: "UNIT", unit_price: 39.90, pack_qty: "", stock: 180, weight_g: 450, is_primary: "true", discount_type: "", discount_value: "", size: "42", tags: "chino,slim,classique", composition: "Coton:98,Élasthanne:2", similar_refs: "PNT-002,JNS-001", pays_fabrication: "Turquie", saison: "Printemps 2026", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "PNT-001", name: "", description: "", category: "", sub_categories: "", color: "Marine", sale_type: "UNIT", unit_price: 39.90, pack_qty: "", stock: 150, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "40", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 7. Pantalon cargo : UNIT + PACK, remise PERCENT sur PACK ───
  { reference: "PNT-002", name: "Cargo Wide Leg", description: "Pantalon cargo coupe large avec poches latérales", category: "Pantalons", sub_categories: "Cargo,Streetwear", color: "Kaki", sale_type: "UNIT", unit_price: 49.90, pack_qty: "", stock: 120, weight_g: 520, is_primary: "true", discount_type: "", discount_value: "", size: "44", tags: "cargo,wide,streetwear,poches", composition: "Coton:100", similar_refs: "PNT-001", pays_fabrication: "Inde", saison: "Automne 2026", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "PNT-002", name: "", description: "", category: "", sub_categories: "", color: "Kaki", sale_type: "PACK", unit_price: 42.00, pack_qty: 4, stock: 30, weight_g: "", is_primary: "", discount_type: "PERCENT", discount_value: 10, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "PNT-002", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "UNIT", unit_price: 49.90, pack_qty: "", stock: 100, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "42", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 8. Jean slim : UNIT, remise AMOUNT ───
  { reference: "JNS-001", name: "Jean Slim Stretch", description: "Jean slim confortable avec stretch, délavage moyen", category: "Jeans", sub_categories: "Slim", color: "Bleu Moyen", sale_type: "UNIT", unit_price: 44.90, pack_qty: "", stock: 250, weight_g: 600, is_primary: "true", discount_type: "AMOUNT", discount_value: 5, size: "40", tags: "slim,stretch,délavé", composition: "Coton:92,Polyester:6,Élasthanne:2", similar_refs: "JNS-002,PNT-001", pays_fabrication: "Tunisie", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 9. Jean large : multi-couleurs, UNIT ───
  { reference: "JNS-002", name: "Jean Wide Vintage", description: "Jean coupe large inspiration 90s, taille haute", category: "Jeans", sub_categories: "Wide,Vintage", color: "Bleu Clair", sale_type: "UNIT", unit_price: 52.00, pack_qty: "", stock: 130, weight_g: 650, is_primary: "true", discount_type: "", discount_value: "", size: "38", tags: "wide,vintage,90s,taille haute", composition: "Coton:100", similar_refs: "JNS-001", pays_fabrication: "Italie", saison: "Printemps 2026", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "JNS-002", name: "", description: "", category: "", sub_categories: "", color: "Noir Brut", sale_type: "UNIT", unit_price: 52.00, pack_qty: "", stock: 100, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "42", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 10. Mocassin cuir : UNIT, tailles variées ───
  { reference: "MOC-001", name: "Mocassin Cambridge", description: "Mocassin en cuir pleine fleur, semelle cousue Blake", category: "Chaussures", sub_categories: "Mocassins", color: "Marron", sale_type: "UNIT", unit_price: 89.90, pack_qty: "", stock: 80, weight_g: 380, is_primary: "true", discount_type: "", discount_value: "", size: "43", tags: "cuir,élégant,blake,classique", composition: "Cuir:100", similar_refs: "MOC-002", pays_fabrication: "Italie", saison: "", dimension_length: 28, dimension_width: 10, dimension_height: 8, dimension_diameter: "", dimension_circumference: "" },
  { reference: "MOC-001", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "UNIT", unit_price: 89.90, pack_qty: "", stock: 60, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "42", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 11. Mocassin daim : UNIT + PACK, remise PERCENT ───
  { reference: "MOC-002", name: "Mocassin Souple Daim", description: "Mocassin en daim souple, intérieur cuir, semelle gomme", category: "Chaussures", sub_categories: "Mocassins", color: "Taupe", sale_type: "UNIT", unit_price: 69.90, pack_qty: "", stock: 100, weight_g: 320, is_primary: "true", discount_type: "PERCENT", discount_value: 20, size: "41", tags: "daim,souple,décontracté", composition: "Daim:80,Cuir:20", similar_refs: "MOC-001", pays_fabrication: "Portugal", saison: "Été 2026", dimension_length: 27, dimension_width: 10, dimension_height: 7, dimension_diameter: "", dimension_circumference: "" },
  { reference: "MOC-002", name: "", description: "", category: "", sub_categories: "", color: "Taupe", sale_type: "PACK", unit_price: 59.90, pack_qty: 4, stock: 15, weight_g: "", is_primary: "", discount_type: "PERCENT", discount_value: 25, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 12. Basket running : multi-couleurs (combinaison), UNIT ───
  { reference: "CHS-001", name: "Sneaker Runner Pro", description: "Basket de running légère, semelle amorti mousse", category: "Chaussures", sub_categories: "Baskets,Running", color: "Blanc/Noir", sale_type: "UNIT", unit_price: 79.90, pack_qty: "", stock: 200, weight_g: 290, is_primary: "true", discount_type: "", discount_value: "", size: "43", tags: "running,léger,amorti,sport", composition: "Synthétique:70,Mousse:30", similar_refs: "CHS-002", pays_fabrication: "Vietnam", saison: "", dimension_length: 29, dimension_width: 11, dimension_height: 12, dimension_diameter: "", dimension_circumference: "" },
  { reference: "CHS-001", name: "", description: "", category: "", sub_categories: "", color: "Noir/Rouge", sale_type: "UNIT", unit_price: 79.90, pack_qty: "", stock: 150, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "42", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 13. Bottine chelsea : UNIT simple ───
  { reference: "CHS-002", name: "Bottine Chelsea Cuir", description: "Bottine chelsea en cuir lisse, élastique latéral, bout arrondi", category: "Chaussures", sub_categories: "Bottines", color: "Noir", sale_type: "UNIT", unit_price: 109.00, pack_qty: "", stock: 70, weight_g: 480, is_primary: "true", discount_type: "", discount_value: "", size: "42", tags: "chelsea,bottine,cuir,classique", composition: "Cuir:90,Caoutchouc:10", similar_refs: "MOC-001,CHS-001", pays_fabrication: "Espagne", saison: "Hiver 2026", dimension_length: 28, dimension_width: 10, dimension_height: 18, dimension_diameter: "", dimension_circumference: "" },

  // ─── 14. Sac à main : UNIT + PACK, 2 couleurs ───
  { reference: "SAC-001", name: "Sac Cabas Parisien", description: "Sac cabas structuré en cuir grainé, double anse, poche intérieure zippée", category: "Sacs", sub_categories: "Cabas,Sacs à main", color: "Noir", sale_type: "UNIT", unit_price: 64.90, pack_qty: "", stock: 90, weight_g: 650, is_primary: "true", discount_type: "", discount_value: "", size: "", tags: "cabas,cuir,parisien,élégant", composition: "Cuir:85,Coton:15", similar_refs: "SAC-002,SAC-003", pays_fabrication: "France", saison: "Automne 2026", dimension_length: 35, dimension_width: 14, dimension_height: 28, dimension_diameter: "", dimension_circumference: "" },
  { reference: "SAC-001", name: "", description: "", category: "", sub_categories: "", color: "Camel", sale_type: "UNIT", unit_price: 64.90, pack_qty: "", stock: 70, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "SAC-001", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "PACK", unit_price: 55.00, pack_qty: 3, stock: 20, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 15. Sac bandoulière : UNIT, remise PERCENT ───
  { reference: "SAC-002", name: "Pochette Bandoulière Mini", description: "Mini sac bandoulière en cuir souple, bandoulière amovible chaîne dorée", category: "Sacs", sub_categories: "Bandoulière,Pochettes", color: "Rose Poudré", sale_type: "UNIT", unit_price: 42.50, pack_qty: "", stock: 120, weight_g: 280, is_primary: "true", discount_type: "PERCENT", discount_value: 15, size: "", tags: "pochette,mini,bandoulière,chaîne", composition: "Cuir:90,Métal:10", similar_refs: "SAC-001", pays_fabrication: "Italie", saison: "Printemps 2026", dimension_length: 22, dimension_width: 6, dimension_height: 15, dimension_diameter: "", dimension_circumference: "" },

  // ─── 16. Sac à dos : multi-couleurs, UNIT ───
  { reference: "SAC-003", name: "Sac à Dos Canvas", description: "Sac à dos en toile épaisse avec empiècements cuir, compartiment laptop 15 pouces", category: "Sacs", sub_categories: "Sacs à dos", color: "Gris/Marron", sale_type: "UNIT", unit_price: 54.90, pack_qty: "", stock: 90, weight_g: 750, is_primary: "true", discount_type: "", discount_value: "", size: "", tags: "sac à dos,canvas,laptop,voyage", composition: "Toile:75,Cuir:25", similar_refs: "SAC-001", pays_fabrication: "Inde", saison: "", dimension_length: 30, dimension_width: 14, dimension_height: 42, dimension_diameter: "", dimension_circumference: "" },
  { reference: "SAC-003", name: "", description: "", category: "", sub_categories: "", color: "Marine/Camel", sale_type: "UNIT", unit_price: 54.90, pack_qty: "", stock: 60, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 17. Chapeau fedora : UNIT + PACK ───
  { reference: "CHP-001", name: "Fedora Laine Premium", description: "Chapeau fedora en feutre de laine, ruban gros-grain contrasté", category: "Chapeaux", sub_categories: "Fedora", color: "Camel", sale_type: "UNIT", unit_price: 35.00, pack_qty: "", stock: 80, weight_g: 150, is_primary: "true", discount_type: "", discount_value: "", size: "58", tags: "fedora,laine,élégant,ruban", composition: "Laine:100", similar_refs: "CHP-002", pays_fabrication: "France", saison: "Automne 2026", dimension_length: "", dimension_width: "", dimension_height: 12, dimension_diameter: 30, dimension_circumference: 58 },
  { reference: "CHP-001", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "UNIT", unit_price: 35.00, pack_qty: "", stock: 60, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "56", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "CHP-001", name: "", description: "", category: "", sub_categories: "", color: "Camel", sale_type: "PACK", unit_price: 28.00, pack_qty: 6, stock: 15, weight_g: "", is_primary: "", discount_type: "PERCENT", discount_value: 15, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 18. Bonnet laine : UNIT, remise PERCENT ───
  { reference: "CHP-002", name: "Bonnet Côtelé Chaud", description: "Bonnet en maille côtelée, doublure polaire, revers ajustable", category: "Chapeaux", sub_categories: "Bonnets", color: "Gris Chiné", sale_type: "UNIT", unit_price: 19.90, pack_qty: "", stock: 350, weight_g: 90, is_primary: "true", discount_type: "PERCENT", discount_value: 25, size: "", tags: "bonnet,chaud,côtelé,polaire", composition: "Laine:50,Acrylique:50", similar_refs: "CHP-001,GNT-001", pays_fabrication: "Écosse", saison: "Hiver 2026", dimension_length: "", dimension_width: "", dimension_height: 22, dimension_diameter: "", dimension_circumference: 56 },

  // ─── 19. Gants cuir : multi-couleurs, UNIT + PACK ───
  { reference: "GNT-001", name: "Gants Cuir Doublés", description: "Gants en cuir d'agneau doublés cachemire, coutures sellier", category: "Accessoires", sub_categories: "Gants", color: "Noir", sale_type: "UNIT", unit_price: 49.90, pack_qty: "", stock: 100, weight_g: 120, is_primary: "true", discount_type: "", discount_value: "", size: "M", tags: "gants,cuir,cachemire,hiver", composition: "Cuir:70,Cachemire:30", similar_refs: "CHP-002", pays_fabrication: "Italie", saison: "Hiver 2026", dimension_length: 24, dimension_width: 10, dimension_height: "", dimension_diameter: "", dimension_circumference: 22 },
  { reference: "GNT-001", name: "", description: "", category: "", sub_categories: "", color: "Marron/Beige", sale_type: "UNIT", unit_price: 52.90, pack_qty: "", stock: 70, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "L", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "GNT-001", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "PACK", unit_price: 42.00, pack_qty: 6, stock: 20, weight_g: "", is_primary: "", discount_type: "AMOUNT", discount_value: 5, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },

  // ─── 20. T-shirt PACK only : remise AMOUNT, promo grossiste ───
  { reference: "TSH-003", name: "T-shirt Uni Lot Pro", description: "T-shirt uni basique vendu en lot, idéal revendeurs et événements", category: "T-shirts", sub_categories: "Basiques,Lots", color: "Blanc", sale_type: "PACK", unit_price: 8.90, pack_qty: 12, stock: 100, weight_g: 170, is_primary: "true", discount_type: "AMOUNT", discount_value: 1, size: "", tags: "lot,pro,revendeur,basique", composition: "Coton:100", similar_refs: "TSH-001,TSH-002", pays_fabrication: "Bangladesh", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "TSH-003", name: "", description: "", category: "", sub_categories: "", color: "Noir", sale_type: "PACK", unit_price: 8.90, pack_qty: 12, stock: 80, weight_g: "", is_primary: "", discount_type: "AMOUNT", discount_value: 1, size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
  { reference: "TSH-003", name: "", description: "", category: "", sub_categories: "", color: "Gris Chiné", sale_type: "PACK", unit_price: 9.50, pack_qty: 12, stock: 60, weight_g: "", is_primary: "", discount_type: "", discount_value: "", size: "", tags: "", composition: "", similar_refs: "", pays_fabrication: "", saison: "", dimension_length: "", dimension_width: "", dimension_height: "", dimension_diameter: "", dimension_circumference: "" },
];

// Track which reference groups for alternating colors
function getProductGroupIndex(reference: string, data: typeof SAMPLE_DATA): number {
  const refs = Array.from(new Set(data.map((d) => d.reference)));
  return refs.indexOf(reference);
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Admin";
  wb.created = new Date();

  // ═══════════════════════════════════════════
  // FEUILLE 1 : Instructions
  // ═══════════════════════════════════════════
  const wsInstructions = wb.addWorksheet("Instructions", {
    properties: { tabColor: { argb: COLORS.green } },
  });

  // Title
  wsInstructions.mergeCells("B2:H2");
  const titleCell = wsInstructions.getCell("B2");
  titleCell.value = "📋  Guide d'importation des produits";
  titleCell.font = { name: "Calibri", size: 16, bold: true, color: { argb: COLORS.dark } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  wsInstructions.getRow(2).height = 36;

  // Subtitle
  wsInstructions.mergeCells("B3:H3");
  const subtitleCell = wsInstructions.getCell("B3");
  subtitleCell.value = "Remplissez l'onglet « Produits » en suivant les règles ci-dessous, puis importez le fichier.";
  subtitleCell.font = { name: "Calibri", size: 11, color: { argb: COLORS.grayMed } };
  wsInstructions.getRow(3).height = 24;

  // Section: Règles générales
  let row = 5;
  const addSection = (title: string, items: string[]) => {
    wsInstructions.mergeCells(`B${row}:H${row}`);
    const sectionCell = wsInstructions.getCell(`B${row}`);
    sectionCell.value = title;
    sectionCell.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.dark } };
    sectionCell.border = { bottom: { style: "medium", color: { argb: COLORS.dark } } };
    wsInstructions.getRow(row).height = 28;
    row++;

    for (const item of items) {
      wsInstructions.mergeCells(`B${row}:H${row}`);
      const itemCell = wsInstructions.getCell(`B${row}`);
      itemCell.value = item;
      itemCell.font = { name: "Calibri", size: 10, color: { argb: COLORS.dark } };
      itemCell.alignment = { wrapText: true, vertical: "top" };
      wsInstructions.getRow(row).height = 20;
      row++;
    }
    row++;
  };

  addSection("📌  Règles générales", [
    "• Une ligne = une variante (combinaison couleur + type de vente UNIT ou PACK).",
    "• Un même produit peut avoir plusieurs lignes avec la même référence (une par variante).",
    "• Seule la ligne principale (is_primary = true) doit contenir le nom, la description, la catégorie, etc.",
    "• Les lignes secondaires n'ont besoin que de : reference, color, sale_type, unit_price, stock.",
    "• Les colonnes marquées d'un astérisque (*) sont obligatoires.",
  ]);

  addSection("🎨  Couleurs multi-tons", [
    "• Pour une variante avec plusieurs sous-couleurs, séparez par / : Doré/Argenté/Or Rose",
    "• Les couleurs doivent exister dans la base (vous pourrez les créer depuis l'aperçu d'import).",
    "• La correspondance est insensible aux accents : Doré = DORE = doré",
  ]);

  addSection("📦  Packs", [
    "• Si sale_type = PACK, la colonne pack_qty est obligatoire.",
    "• Le prix total du pack sera calculé : unit_price × pack_qty (moins la remise éventuelle).",
  ]);

  addSection("💰  Remises", [
    "• discount_type : PERCENT (ex: 10 = -10%) ou AMOUNT (ex: 2 = -2€ par unité).",
    "• Laissez vide si pas de remise.",
  ]);

  addSection("🏷️  Tags & Composition", [
    "• tags : séparés par des virgules → étoile,fin,tendance",
    "• composition : format Matière:pourcentage → Coton:85,Or:15",
    "• similar_refs : références de produits similaires, séparées par des virgules.",
  ]);

  addSection("🌍  Pays & Saisons", [
    "• pays_fabrication : nom du pays de fabrication (doit exister dans la base, sinon créable depuis l'aperçu).",
    "• saison : nom de la saison (doit exister dans la base, sinon créable depuis l'aperçu).",
    "• Ces champs sont au niveau produit : ne les renseignez que sur la ligne principale.",
  ]);

  addSection("📐  Dimensions", [
    "• Toutes les dimensions sont en centimètres (cm).",
    "• dimension_length, dimension_width, dimension_height : longueur, largeur, hauteur.",
    "• dimension_diameter : diamètre (ex: bague, bracelet).",
    "• dimension_circumference : circonférence (ex: tour de doigt, tour de poignet).",
    "• Les dimensions sont des champs produit : elles ne doivent être renseignées que sur la ligne principale.",
  ]);

  // Column reference table
  row += 1;
  wsInstructions.mergeCells(`B${row}:H${row}`);
  const refTitle = wsInstructions.getCell(`B${row}`);
  refTitle.value = "📊  Référence des colonnes";
  refTitle.font = { name: "Calibri", size: 12, bold: true, color: { argb: COLORS.dark } };
  refTitle.border = { bottom: { style: "medium", color: { argb: COLORS.dark } } };
  wsInstructions.getRow(row).height = 28;
  row++;

  // Table headers
  const refHeaders = ["Colonne", "Obligatoire", "Description", "Exemple"];
  const refHeaderRow = wsInstructions.getRow(row);
  [2, 3, 5, 7].forEach((col, i) => {
    const cell = refHeaderRow.getCell(col);
    cell.value = refHeaders[i];
    cell.font = { name: "Calibri", size: 10, bold: true, color: { argb: COLORS.white } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.dark } };
    cell.alignment = { horizontal: "left", vertical: "middle" };
    cell.border = BORDER_THIN;
  });
  // Merge description & example cols
  wsInstructions.mergeCells(`E${row}:F${row}`);
  wsInstructions.mergeCells(`G${row}:H${row}`);
  refHeaderRow.height = 24;
  row++;

  for (const col of COLUMNS) {
    const r = wsInstructions.getRow(row);
    const bgColor = col.required ? COLORS.greenLight : COLORS.white;

    const cellCol = r.getCell(2);
    cellCol.value = col.key;
    cellCol.font = { name: "Calibri", size: 10, bold: col.required, color: { argb: COLORS.dark } };
    cellCol.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellCol.border = BORDER_THIN;

    const cellReq = r.getCell(3);
    cellReq.value = col.required ? "✓ Oui" : "Non";
    cellReq.font = { name: "Calibri", size: 10, bold: col.required, color: { argb: col.required ? COLORS.green : COLORS.grayMed } };
    cellReq.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellReq.alignment = { horizontal: "center" };
    cellReq.border = BORDER_THIN;

    wsInstructions.mergeCells(`E${row}:F${row}`);
    const cellDesc = r.getCell(5);
    cellDesc.value = col.description;
    cellDesc.font = { name: "Calibri", size: 10, color: { argb: COLORS.dark } };
    cellDesc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellDesc.alignment = { wrapText: true };
    cellDesc.border = BORDER_THIN;

    wsInstructions.mergeCells(`G${row}:H${row}`);
    const cellEx = r.getCell(7);
    cellEx.value = col.example;
    cellEx.font = FONT_MUTED;
    cellEx.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
    cellEx.border = BORDER_THIN;

    r.height = 20;
    row++;
  }

  wsInstructions.getColumn(1).width = 3;
  wsInstructions.getColumn(2).width = 18;
  wsInstructions.getColumn(3).width = 14;
  wsInstructions.getColumn(4).width = 2;
  wsInstructions.getColumn(5).width = 22;
  wsInstructions.getColumn(6).width = 10;
  wsInstructions.getColumn(7).width = 16;
  wsInstructions.getColumn(8).width = 16;

  // Protect instructions sheet
  wsInstructions.protect("", { selectLockedCells: true, selectUnlockedCells: true });

  // ═══════════════════════════════════════════
  // FEUILLE 2 : Produits (données)
  // ═══════════════════════════════════════════
  const wsProduits = wb.addWorksheet("Produits", {
    properties: { tabColor: { argb: COLORS.dark } },
    views: [{ state: "frozen", ySplit: 1, activeCell: "A2" }],
  });

  // Set columns
  wsProduits.columns = COLUMNS.map((col) => ({
    header: col.header,
    key: col.key,
    width: col.width,
  }));

  // Style header row — name in French + description as cell comment
  const headerRow = wsProduits.getRow(1);
  headerRow.height = 34;
  headerRow.eachCell((cell, colNumber) => {
    const colDef = COLUMNS[colNumber - 1];
    cell.font = FONT_HEADER;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: colDef.required ? COLORS.dark : COLORS.grayMed },
    };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: COLORS.dark } },
      bottom: { style: "medium", color: { argb: COLORS.dark } },
      left: { style: "thin", color: { argb: COLORS.dark } },
      right: { style: "thin", color: { argb: COLORS.dark } },
    };
    // Add description as cell comment so the user sees it on hover
    cell.note = `${colDef.description}${colDef.example ? `\nExemple : ${colDef.example}` : ""}`;
  });

  // Alternating product group colors
  const groupColors = [COLORS.white, COLORS.grayLight];

  // Add sample data rows starting at row 3
  SAMPLE_DATA.forEach((dataRow, idx) => {
    const excelRow = wsProduits.addRow(dataRow);
    const groupIdx = getProductGroupIndex(dataRow.reference, SAMPLE_DATA);
    const bgColor = groupColors[groupIdx % 2];

    excelRow.height = 22;
    excelRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const colDef = COLUMNS[colNumber - 1];
      const isEmpty = cell.value === "" || cell.value === null || cell.value === undefined;

      cell.font = isEmpty ? FONT_MUTED : FONT_BODY;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bgColor } };
      cell.border = BORDER_THIN;
      cell.alignment = { vertical: "middle", wrapText: colDef.key === "description" };

      // Highlight required empty cells
      if (colDef.required && isEmpty && idx > 0) {
        // Secondary rows don't need name/description/category
        // Only reference, color, sale_type, unit_price, stock are truly required per row
      }

      // Center numeric / short columns
      if (["sale_type", "unit_price", "pack_qty", "stock", "weight_g", "is_primary", "discount_type", "discount_value", "size", "dimension_length", "dimension_width", "dimension_height", "dimension_diameter", "dimension_circumference"].includes(colDef.key)) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
    });
  });

  // Add data validation dropdowns (data starts at row 2 now, no description row)
  const dataStartRow = 2;
  const dataEndRow = 100;

  // sale_type dropdown
  const saleTypeCol = COLUMNS.findIndex((c) => c.key === "sale_type") + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    wsProduits.getCell(r, saleTypeCol).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"UNIT,PACK"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez UNIT ou PACK",
    };
  }

  // discount_type dropdown
  const discountTypeCol = COLUMNS.findIndex((c) => c.key === "discount_type") + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    wsProduits.getCell(r, discountTypeCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"PERCENT,AMOUNT"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: "Choisissez PERCENT ou AMOUNT (ou laissez vide)",
    };
  }

  // is_primary dropdown
  const isPrimaryCol = COLUMNS.findIndex((c) => c.key === "is_primary") + 1;
  for (let r = dataStartRow; r <= dataEndRow; r++) {
    wsProduits.getCell(r, isPrimaryCol).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"true,"'],
      showErrorMessage: true,
      errorTitle: "Valeur invalide",
      error: 'Indiquez "true" ou laissez vide',
    };
  }

  // Auto-filter on header
  wsProduits.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMNS.length },
  };

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="template-produits-import.xlsx"',
    },
  });
}
