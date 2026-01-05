import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type VisionVertex = { x?: number; y?: number };
type VisionAnnot = {
  description?: string;
  boundingPoly?: { vertices?: VisionVertex[] };
};

type TokenBox = {
  text: string;
  digits: string;
  digitLen: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status },
  );
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function safeNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function digitsOf(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function hasLetters(s: string) {
  return /[a-zA-Z]/.test(s || "");
}

function resolveServiceAccount() {
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    "";

  if (!b64) return null;

  try {
    const json = Buffer.from(b64, "base64").toString("utf8");
    return JSON.parse(json);
  } catch {
    throw new Error(
      "Falha ao ler o service account. Verifique o base64 do JSON em GCP_KEY_BASE64 (ou GOOGLE_SERVICE_ACCOUNT_B64).",
    );
  }
}

async function getVisionAuth() {
  const apiKey =
    process.env.GCP_VISION_API_KEY ||
    process.env.GOOGLE_VISION_API_KEY ||
    "";

  if (apiKey) return { mode: "apikey" as const, apiKey };

  const creds = resolveServiceAccount();
  if (!creds) {
    throw new Error(
      "Sem credenciais: configure GCP_VISION_API_KEY (ou GOOGLE_VISION_API_KEY) ou GCP_KEY_BASE64.",
    );
  }

  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não consegui obter access token (GoogleAuth).");

  return { mode: "bearer" as const, token };
}

function polyToBox(annot: VisionAnnot): TokenBox | null {
  const text = (annot.description || "").trim();
  if (!text) return null;

  const vs = annot.boundingPoly?.vertices || [];
  if (!vs.length) return null;

  const xs = vs.map((v) => safeNum(v.x, 0));
  const ys = vs.map((v) => safeNum(v.y, 0));

  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);

  const digits = digitsOf(text);

  return {
    text,
    digits,
    digitLen: digits.length,
    minX,
    maxX,
    minY,
    maxY,
    w,
    h,
    cx: minX + w / 2,
    cy: minY + h / 2,
  };
}

function docBounds(tokens: TokenBox[]) {
  const minX = Math.min(...tokens.map((t) => t.minX));
  const maxX = Math.max(...tokens.map((t) => t.maxX));
  const minY = Math.min(...tokens.map((t) => t.minY));
  const maxY = Math.max(...tokens.map((t) => t.maxY));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return { minX, maxX, minY, maxY, w, h };
}

type Row = { cy: number; avgH: number; items: TokenBox[] };

function clusterRows(tokens: TokenBox[]) {
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy);
  const rows: Row[] = [];

  for (const t of sorted) {
    let placed = false;

    for (const r of rows) {
      const tol = Math.max(12, Math.min(t.h, r.avgH) * 0.7);
      if (Math.abs(t.cy - r.cy) <= tol) {
        r.items.push(t);
        r.cy = r.items.reduce((s, x) => s + x.cy, 0) / r.items.length;
        r.avgH = r.items.reduce((s, x) => s + x.h, 0) / r.items.length;
        placed = true;
        break;
      }
    }

    if (!placed) rows.push({ cy: t.cy, avgH: t.h, items: [t] });
  }

  for (const r of rows) r.items.sort((a, b) => a.minX - b.minX);
  return rows;
}

function groupBox(tokens: TokenBox[]): TokenBox | null {
  if (!tokens.length) return null;
  const minX = Math.min(...tokens.map((t) => t.minX));
  const maxX = Math.max(...tokens.map((t) => t.maxX));
  const minY = Math.min(...tokens.map((t) => t.minY));
  const maxY = Math.max(...tokens.map((t) => t.maxY));
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return {
    text: tokens.map((t) => t.text).join(" "),
    digits: tokens.map((t) => t.digits).join(""),
    digitLen: tokens.reduce((s, t) => s + t.digitLen, 0),
    minX,
    maxX,
    minY,
    maxY,
    w,
    h,
    cx: minX + w / 2,
    cy: minY + h / 2,
  };
}

/** acha 1 dígito à direita (mesma “linha visual”), útil pra casa decimal */
function findOneDigitRight(main: TokenBox, allDigits: TokenBox[]) {
  const mainCy = main.cy;
  const mainH = main.h;

  const candidates = allDigits
    .filter((t) => t !== main)
    .filter((t) => t.digitLen === 1)
    .filter((t) => !hasLetters(t.text))
    .filter((t) => Math.abs(t.cy - mainCy) <= Math.max(10, mainH * 0.9))
    .filter((t) => t.minX >= main.maxX)
    .map((t) => ({ t, gap: t.minX - main.maxX }))
    .filter(({ gap }) => gap >= 0 && gap <= Math.max(70, mainH * 3.2))
    .sort((a, b) => a.gap - b.gap);

  return candidates[0]?.t || null;
}

/* ===========================
   PARSERS
=========================== */

/**
 * HORÍMETRO (corrigido):
 * - mostradores comuns: "03644" + "9" (decimal separado)
 * - regra nova:
 *   - se vier 5 dígitos, NÃO assumir decimal embutida
 *   - tentar achar 1 dígito à direita e anexar => 6 dígitos
 *   - parse:
 *       6+ => último é decimal
 *       5 => inteiro (",0")
 */
function pickHorimetroDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length) return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };

  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };

  const bounds = docBounds(clean);
  const maxH = Math.max(...clean.map((t) => t.h));
  const minBigH = maxH * 0.66;

  // tokens longos (4–6) e altos
  const longTokens = clean
    .filter((t) => t.h >= minBigH)
    .filter((t) => t.digitLen >= 4 && t.digitLen <= 6)
    .sort((a, b) => {
      if (b.h !== a.h) return b.h - a.h;
      return b.digitLen - a.digitLen;
    });

  if (longTokens.length) {
    const main = longTokens[0];
    let digits = main.digits;
    const used: TokenBox[] = [main];

    // SE vier 5 dígitos, tenta anexar 1 dígito à direita (decimal separado)
    if (digits.length === 5) {
      const dec = findOneDigitRight(main, clean);
      if (dec) {
        digits = digits + dec.digits;
        used.push(dec);
        dbg.decFound = true;
      } else {
        dbg.decFound = false;
      }
    }

    // SE vier 4 dígitos, também tenta anexar decimal
    if (digits.length === 4) {
      const dec = findOneDigitRight(main, clean);
      if (dec) {
        digits = digits + dec.digits;
        used.push(dec);
        dbg.decFound = true;
      } else {
        dbg.decFound = false;
      }
    }

    dbg.method = "long-token";
    dbg.maxH = maxH;
    dbg.minBigH = minBigH;
    dbg.bounds = { w: bounds.w, h: bounds.h };
    dbg.picked = { digitsRaw: main.digits, digitsFinal: digits };
    return { digits, used, dbg };
  }

  // fallback por linha
  const rows = clusterRows(clean);

  const rowCands = rows
    .map((r) => {
      const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);

      // horímetro costuma ficar na parte de baixo do recorte
      const strong = r.items.filter((t) => t.h >= r.avgH * 0.75);
      const digitsRaw = strong.map((t) => t.digits).join("");

      return { r, strong, digitsRaw, yNorm };
    })
    .filter((c) => c.digitsRaw.length >= 4 && c.digitsRaw.length <= 7)
    .map((c) => ({
      ...c,
      score: c.r.avgH * (1 + c.digitsRaw.length) * (1 + c.yNorm * 0.35),
    }))
    .sort((a, b) => b.score - a.score);

  if (!rowCands.length) {
    dbg.method = "none-row";
    dbg.maxH = maxH;
    return { digits: "", used: [], dbg };
  }

  const picked = rowCands[0];
  let digits = digitsOf(picked.digitsRaw);
  const used = [...picked.strong];

  const gb = groupBox(picked.strong);
  if (gb && (digits.length === 4 || digits.length === 5)) {
    const dec = findOneDigitRight(gb, clean);
    if (dec) {
      digits = digits + dec.digits;
      used.push(dec);
      dbg.decFound = true;
    }
  }

  dbg.method = "row";
  dbg.maxH = maxH;
  dbg.minBigH = minBigH;
  dbg.top = rowCands.slice(0, 6).map((c) => ({
    digits: c.digitsRaw,
    score: c.score,
    yNorm: c.yNorm,
    avgH: c.r.avgH,
  }));

  return { digits, used, dbg };
}

function parseHorimetro(digits: string) {
  let d = digitsOf(digits);
  if (d.length < 4) return null;

  // se vier muita coisa, fica com os últimos 6 (normalmente inclui o decimal no final)
  if (d.length > 6) d = d.slice(-6);

  // 6 => último dígito é decimal
  if (d.length === 6) {
    const intPart = d.slice(0, -1);
    const dec = d.slice(-1);
    const i = parseInt(intPart, 10);
    const dc = parseInt(dec, 10);
    if (!Number.isFinite(i) || !Number.isFinite(dc)) return null;
    const v = i + dc / 10;
    if (v < 0 || v > 1000000) return null;
    return { value: v, best_input: `${i},${dc}` };
  }

  // 5 => inteiro (não assume decimal embutida)
  if (d.length === 5) {
    const i = parseInt(d, 10);
    if (!Number.isFinite(i)) return null;
    if (i < 0 || i > 1000000) return null;
    return { value: i, best_input: `${i},0` };
  }

  // 4 => inteiro
  const i = parseInt(d, 10);
  if (!Number.isFinite(i)) return null;
  if (i < 0 || i > 1000000) return null;
  return { value: i, best_input: `${i},0` };
}

/**
 * ABASTECIMENTO (corrigido):
 * - casos comuns: "026" + "5" (decimal separado)
 * - regra:
 *   - tenta pegar a LINHA dos dígitos grandes
 *   - se formar 3 dígitos, busca 1 dígito à direita e anexa
 */
function pickAbastecimentoDigits(digitTokens: TokenBox[]) {
  const dbg: any = {};
  if (!digitTokens.length) return { digits: "", used: [] as TokenBox[], dbg: { method: "none" } };

  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) return { digits: "", used: [] as TokenBox[], dbg: { method: "none-clean" } };

  const bounds = docBounds(clean);

  // maxH ignorando tokens muito longos
  const pool = clean.filter((t) => t.digitLen <= 6);
  const maxH = Math.max(...(pool.length ? pool : clean).map((t) => t.h));
  const minBigH = maxH * 0.68;

  const bigish = clean.filter((t) => t.digitLen <= 6 && t.h >= minBigH);

  dbg.maxH = maxH;
  dbg.minBigH = minBigH;
  dbg.bigCount = bigish.length;

  const rows = clusterRows(bigish.length ? bigish : clean);

  type Cand = { digitsRaw: string; used: TokenBox[]; avgH: number; cy: number; yNorm: number; src: string; mainBox?: TokenBox | null };

  const candidates: Cand[] = [];

  for (const r of rows) {
    const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);

    // litros: linha dos dígitos grandes fica acima do contador pequeno
    if (yNorm > 0.78) continue;

    // usa os mais fortes
    const strong = r.items.filter((t) => t.h >= r.avgH * 0.72);
    if (!strong.length) continue;

    const digitsRaw = strong.map((t) => t.digits).join("");
    candidates.push({
      digitsRaw,
      used: strong,
      avgH: r.avgH,
      cy: r.cy,
      yNorm,
      src: "row",
      mainBox: groupBox(strong),
    });
  }

  // fallback: tokens avulsos grandes
  for (const t of bigish) {
    const yNorm = clamp((t.cy - bounds.minY) / bounds.h, 0, 1);
    if (yNorm > 0.78) continue;
    candidates.push({
      digitsRaw: t.digits,
      used: [t],
      avgH: t.h,
      cy: t.cy,
      yNorm,
      src: "token",
      mainBox: t,
    });
  }

  // ordena: maior avgH primeiro; empate -> mais acima
  candidates.sort((a, b) => {
    if (b.avgH !== a.avgH) return b.avgH - a.avgH;
    return a.cy - b.cy;
  });

  dbg.top = candidates.slice(0, 10).map((c) => ({
    src: c.src,
    digits: c.digitsRaw,
    avgH: c.avgH,
    yNorm: c.yNorm,
  }));

  if (!candidates.length) return { digits: "", used: [], dbg: { ...dbg, method: "no-cands" } };

  for (const c of candidates) {
    let d = digitsOf(c.digitsRaw);

    // se veio 3 dígitos, tenta achar o 1 dígito decimal à direita
    if (d.length === 3 && c.mainBox) {
      const dec = findOneDigitRight(c.mainBox, clean);
      if (dec) {
        d = d + dec.digits; // vira 4 dígitos
        c.used = [...c.used, dec];
        dbg.decFound = true;
      } else {
        dbg.decFound = false;
      }
    }

    // normaliza para 4 dígitos
    if (d.length === 3) d = d.padStart(4, "0");
    if (d.length > 4) d = d.slice(-4);
    if (d.length !== 4) continue;

    dbg.method = `picked-${c.src}`;
    dbg.picked = { digitsRaw: c.digitsRaw, digits: d, avgH: c.avgH, yNorm: c.yNorm };
    return { digits: d, used: c.used, dbg };
  }

  return { digits: "", used: [], dbg: { ...dbg, method: "no-4digits" } };
}

function parseAbastecimento(digits: string) {
  let d = digitsOf(digits);
  if (!d) return null;

  if (d.length === 3) d = d.padStart(4, "0");
  if (d.length > 4) d = d.slice(-4);
  if (d.length !== 4) return null;

  const intPart = d.slice(0, 3);
  const dec = d.slice(3);

  const i = parseInt(intPart, 10);
  const dc = parseInt(dec, 10);
  if (!Number.isFinite(i) || !Number.isFinite(dc)) return null;

  const value = i + dc / 10;
  if (value < 0 || value > 1200) return null;

  return { value, best_input: `${i},${dc}` };
}

/**
 * ODÔMETRO (novo):
 * - junta tokens da MESMA LINHA (ex.: "12" + "195,0")
 * - devolve inteiro SEM vírgula (pra não virar 121950 no onlyDigits)
 */
function pickOdometroDigits(digitTokens: TokenBox[], rawFull: string) {
  const dbg: any = {};
  if (!digitTokens.length) return { digits: "", used: [] as TokenBox[], hadSep: false, dbg: { method: "none" } };

  const clean = digitTokens.filter((t) => t.digitLen > 0 && !hasLetters(t.text));
  if (!clean.length) return { digits: "", used: [] as TokenBox[], hadSep: false, dbg: { method: "none-clean" } };

  const bounds = docBounds(clean);
  const rows = clusterRows(clean);

  const rowCands = rows
    .map((r) => {
      const yNorm = clamp((r.cy - bounds.minY) / bounds.h, 0, 1);

      // odômetro costuma estar mais “baixo” e central
      if (yNorm < 0.25) return null;

      const strong = r.items
        .filter((t) => t.h >= r.avgH * 0.65)
        .filter((t) => t.digitLen > 0);

      const digitsRaw = strong.map((t) => t.digits).join("");
      const hadSepToken = strong.some((t) => /[.,]/.test(t.text));
      const hadSepRaw = /(\d+[.,]\d)/.test(rawFull || "");

      return {
        r,
        strong,
        digitsRaw,
        yNorm,
        hadSep: hadSepToken || hadSepRaw,
        score: (digitsRaw.length || 0) * r.avgH * (1 + yNorm * 0.15),
      };
    })
    .filter(Boolean) as any[];

  rowCands.sort((a, b) => b.score - a.score);

  dbg.top = rowCands.slice(0, 6).map((c) => ({
    digits: c.digitsRaw,
    yNorm: c.yNorm,
    avgH: c.r.avgH,
    score: c.score,
    hadSep: c.hadSep,
  }));

  const picked = rowCands.find((c) => digitsOf(c.digitsRaw).length >= 4) || rowCands[0];
  if (!picked) return { digits: "", used: [], hadSep: false, dbg: { ...dbg, method: "no-row" } };

  dbg.method = "row";
  dbg.picked = { digitsRaw: picked.digitsRaw, hadSep: picked.hadSep };

  return { digits: digitsOf(picked.digitsRaw), used: picked.strong, hadSep: !!picked.hadSep, dbg };
}

function parseOdometro(digits: string, hadSep: boolean) {
  let d = digitsOf(digits);
  if (d.length < 3) return null;

  // se veio com separador (12195,0 => 121950), remove o último dígito (decimal)
  if (hadSep && d.length >= 6) d = d.slice(0, -1);

  // fallback “esperto”: se tem 6 dígitos e termina em 0, geralmente é decimal ,0
  if (!hadSep && d.length === 6 && d.endsWith("0")) {
    const as5 = parseInt(d.slice(0, -1), 10);
    if (Number.isFinite(as5) && as5 >= 1000 && as5 <= 999999) {
      d = d.slice(0, -1);
    }
  }

  const i = parseInt(d, 10);
  if (!Number.isFinite(i)) return null;
  if (i < 0 || i > 99999999) return null;

  return { value: i, best_input: String(i) };
}

/* ===========================
   SHARP PREPROCESS
=========================== */

type Variant = { name: string; bytes: Buffer; meta: any };

function rectByKind(kind: string, w: number, h: number, variant: "main" | "tight") {
  // recortes por proporção (ajustados para “cortar ruído” e focar nos números)
  if (kind === "abastecimento") {
    // pega a faixa dos dígitos grandes e evita o contador pequeno inferior
    const x0 = variant === "tight" ? 0.06 : 0.04;
    const x1 = variant === "tight" ? 0.94 : 0.96;
    const y0 = variant === "tight" ? 0.22 : 0.18;
    const y1 = variant === "tight" ? 0.62 : 0.70;
    return {
      left: Math.floor(w * x0),
      top: Math.floor(h * y0),
      width: Math.max(1, Math.floor(w * (x1 - x0))),
      height: Math.max(1, Math.floor(h * (y1 - y0))),
    };
  }

  if (kind === "horimetro") {
    // visor do horímetro costuma ficar mais embaixo
    const x0 = variant === "tight" ? 0.18 : 0.12;
    const x1 = variant === "tight" ? 0.88 : 0.92;
    const y0 = variant === "tight" ? 0.50 : 0.42;
    const y1 = variant === "tight" ? 0.92 : 0.95;
    return {
      left: Math.floor(w * x0),
      top: Math.floor(h * y0),
      width: Math.max(1, Math.floor(w * (x1 - x0))),
      height: Math.max(1, Math.floor(h * (y1 - y0))),
    };
  }

  // odômetro: normalmente faixa inferior do painel
  const x0 = variant === "tight" ? 0.14 : 0.08;
  const x1 = variant === "tight" ? 0.96 : 0.98;
  const y0 = variant === "tight" ? 0.48 : 0.38;
  const y1 = variant === "tight" ? 0.86 : 0.92;
  return {
    left: Math.floor(w * x0),
    top: Math.floor(h * y0),
    width: Math.max(1, Math.floor(w * (x1 - x0))),
    height: Math.max(1, Math.floor(h * (y1 - y0))),
  };
}

async function buildSharpVariants(input: Uint8Array, kind: string): Promise<Variant[]> {
  const base = sharp(Buffer.from(input)).rotate(); // respeita EXIF

  const meta = await base.metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;

  // fallback se não tiver meta
  const W = w || 2000;
  const H = h || 1500;

  const common = (s: sharp.Sharp) =>
    s
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1.1, m1: 1, m2: 2 })
      .resize({ width: 1800, withoutEnlargement: false });

  const variants: Variant[] = [];

  // 1) full melhorado
  {
    const bytes = await common(base.clone()).jpeg({ quality: 92 }).toBuffer();
    variants.push({ name: "full-gray", bytes, meta: { w: W, h: H } });
  }

  // 2) crop main
  {
    const r = rectByKind(kind, W, H, "main");
    const bytes = await common(base.clone().extract(r)).jpeg({ quality: 92 }).toBuffer();
    variants.push({ name: "crop-main-gray", bytes, meta: { rect: r } });
  }

  // 3) crop tight + threshold (bom para LCD)
  {
    const r = rectByKind(kind, W, H, "tight");
    const bytes = await base
      .clone()
      .extract(r)
      .grayscale()
      .normalize()
      .resize({ width: 2000, withoutEnlargement: false })
      .sharpen({ sigma: 1.3, m1: 1, m2: 2 })
      .threshold(165)
      .jpeg({ quality: 92 })
      .toBuffer();
    variants.push({ name: "crop-tight-thresh", bytes, meta: { rect: r } });
  }

  return variants;
}

/* ===========================
   VISION
=========================== */

async function visionTextDetection(imageBytes: Uint8Array) {
  const base64 = Buffer.from(imageBytes).toString("base64");
  const payload = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "TEXT_DETECTION" }],
      },
    ],
  };

  const auth = await getVisionAuth();

  const endpoint =
    auth.mode === "apikey"
      ? `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(auth.apiKey)}`
      : `https://vision.googleapis.com/v1/images:annotate`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers:
      auth.mode === "bearer"
        ? { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" }
        : { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Vision API falhou: HTTP ${res.status} - ${JSON.stringify(data)?.slice(0, 500)}`,
    );
  }
  return data;
}

type ParsedAttempt = {
  variant: string;
  ok: boolean;
  best: number | null;
  best_input: string;
  picked_digits: string;
  picked_meta: any;
  used_tokens: Array<{ text: string; digits: string; h: number; x: [number, number]; y: [number, number] }>;
  raw: string;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "").toLowerCase().trim(); // horimetro | abastecimento | odometro
    const equip = (searchParams.get("equip") || "").trim();
    const url = (searchParams.get("url") || "").trim();

    if (!kind) return jsonError("Informe ?kind=horimetro|abastecimento|odometro", 400);
    if (!url) return jsonError("Informe ?url=<signed_url>", 400);

    // baixa imagem (Supabase signed url)
    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return jsonError("Falha ao baixar imagem (signed url).", 400, { status: imgRes.status });
    }
    const original = new Uint8Array(await imgRes.arrayBuffer());

    // tenta 2-3 variantes com sharp
    const variants = await buildSharpVariants(original, kind);

    const attempts: ParsedAttempt[] = [];

    for (const v of variants) {
      const vision = await visionTextDetection(v.bytes);

      const resp0 = vision?.responses?.[0] || {};
      const textAnnotations: VisionAnnot[] = resp0?.textAnnotations || [];
      const rawFull = (textAnnotations?.[0]?.description || "").trim();

      const tokens: TokenBox[] = (textAnnotations || [])
        .slice(1)
        .map(polyToBox)
        .filter(Boolean) as TokenBox[];

      const digitTokens = tokens.filter((t) => t.digitLen > 0);

      let best: number | null = null;
      let best_input = "";
      let pickedDigits = "";
      let usedTokens: TokenBox[] = [];
      let pickedDebug: any = {};

      if (!digitTokens.length) {
        attempts.push({
          variant: v.name,
          ok: false,
          best: null,
          best_input: "",
          picked_digits: "",
          picked_meta: { note: "sem tokens com dígitos", sharp_meta: v.meta },
          used_tokens: [],
          raw: rawFull,
        });
        continue;
      }

      if (kind === "horimetro") {
        const picked = pickHorimetroDigits(digitTokens);
        pickedDigits = picked.digits;
        usedTokens = picked.used;
        pickedDebug = { ...picked.dbg, sharp_meta: v.meta };

        const parsed = parseHorimetro(pickedDigits);
        if (parsed) {
          best = parsed.value;
          best_input = parsed.best_input;
        }
      } else if (kind === "abastecimento") {
        const picked = pickAbastecimentoDigits(digitTokens);
        pickedDigits = picked.digits;
        usedTokens = picked.used;
        pickedDebug = { ...picked.dbg, sharp_meta: v.meta };

        const parsed = parseAbastecimento(pickedDigits);
        if (parsed) {
          best = parsed.value;
          best_input = parsed.best_input;
        }
      } else if (kind === "odometro") {
        const picked = pickOdometroDigits(digitTokens, rawFull);
        pickedDigits = picked.digits;
        usedTokens = picked.used;
        pickedDebug = { ...picked.dbg, hadSep: picked.hadSep, sharp_meta: v.meta };

        const parsed = parseOdometro(pickedDigits, picked.hadSep);
        if (parsed) {
          best = parsed.value;
          best_input = parsed.best_input; // SEM vírgula
        }
      } else {
        return jsonError("kind inválido. Use horimetro, abastecimento ou odometro.", 400);
      }

      const att: ParsedAttempt = {
        variant: v.name,
        ok: best !== null,
        best,
        best_input,
        picked_digits: pickedDigits,
        picked_meta: pickedDebug,
        used_tokens: usedTokens.map((t) => ({
          text: t.text,
          digits: t.digits,
          h: t.h,
          x: [t.minX, t.maxX],
          y: [t.minY, t.maxY],
        })),
        raw: rawFull,
      };

      attempts.push(att);

      // early exit: primeira que deu certo
      if (best !== null) {
        return NextResponse.json({
          ok: true,
          kind,
          equip: equip || null,
          best,
          best_input,
          candidates: [best],
          candidates_input: [best_input],
          raw: rawFull,
          debug: {
            variant: v.name,
            tries: attempts,
            token_count: digitTokens.length,
            picked_digits: pickedDigits,
            picked_strategy: pickedDebug?.method || pickedDebug?.strategy || null,
            picked_meta: pickedDebug || null,
            used_tokens: att.used_tokens,
          },
        });
      }
    }

    // nenhuma variante deu parse
    const last = attempts[attempts.length - 1];

    return NextResponse.json({
      ok: true,
      kind,
      equip: equip || null,
      best: null,
      best_input: "",
      candidates: [],
      candidates_input: [],
      raw: last?.raw || "",
      debug: {
        variant: last?.variant || null,
        tries: attempts,
        note: "nenhuma variante gerou valor válido",
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR.", 500);
  }
}
