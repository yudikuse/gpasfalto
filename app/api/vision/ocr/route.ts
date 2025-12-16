import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type VisionVertex = { x?: number; y?: number };
type VisionAnnot = {
  description?: string;
  boundingPoly?: { vertices?: VisionVertex[] };
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...(extra ? { extra } : {}) }, { status });
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function safeNum(n: any, fallback = 0) {
  const x = Number(n);
  return Number.isFinite(x) ? x : fallback;
}

function resolveServiceAccount() {
  // Use o mesmo padrão que você já usa nos outros projetos:
  // - GCP_KEY_BASE64 = base64 do JSON do service account
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
    throw new Error("Falha ao ler o service account. Verifique o base64 do JSON em GCP_KEY_BASE64.");
  }
}

async function getBearerToken() {
  // Opcional: se você preferir API KEY, configure GCP_VISION_API_KEY e não usa token.
  const apiKey = process.env.GCP_VISION_API_KEY || "";
  if (apiKey) return { mode: "apikey" as const, apiKey };

  const creds = resolveServiceAccount();
  if (!creds) {
    throw new Error("Sem credenciais: configure GCP_KEY_BASE64 (ou GCP_VISION_API_KEY).");
  }

  const auth = new GoogleAuth({
    credentials: creds,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const token = await auth.getAccessToken();
  if (!token) throw new Error("Não consegui obter access token do GoogleAuth.");

  return { mode: "bearer" as const, token };
}

type TokenBox = {
  text: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

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

  return {
    text,
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

function clusterRows(tokens: TokenBox[]) {
  // agrupa por “linha” usando proximidade do cy
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy);
  const rows: { cy: number; items: TokenBox[]; avgH: number }[] = [];

  for (const t of sorted) {
    const tol = Math.max(12, t.h * 0.6);
    let placed = false;

    for (const r of rows) {
      if (Math.abs(t.cy - r.cy) <= tol) {
        r.items.push(t);
        r.cy = r.items.reduce((s, x) => s + x.cy, 0) / r.items.length;
        r.avgH = r.items.reduce((s, x) => s + x.h, 0) / r.items.length;
        placed = true;
        break;
      }
    }

    if (!placed) {
      rows.push({ cy: t.cy, items: [t], avgH: t.h });
    }
  }

  return rows;
}

function pickBestRowForBigDigits(rows: { cy: number; items: TokenBox[]; avgH: number }[]) {
  if (!rows.length) return null;

  // altura “total” aproximada do documento (pra penalizar linha muito embaixo)
  const docMaxY = Math.max(...rows.flatMap((r) => r.items.map((t) => t.maxY)));
  const docMinY = Math.min(...rows.flatMap((r) => r.items.map((t) => t.minY)));
  const docH = Math.max(1, docMaxY - docMinY);

  let best = { score: -1, row: rows[0] as any };

  for (const r of rows) {
    const digitsCount = r.items
      .map((t) => (t.text.match(/\d/g) || []).length)
      .reduce((a, b) => a + b, 0);

    if (digitsCount < 2) continue;

    const yNorm = clamp((r.cy - docMinY) / docH, 0, 1);

    // score: prioriza maior altura (dígitos grandes) + quantidade de dígitos
    // penaliza o rodapé (onde normalmente ficam os dígitos pequenos)
    const bottomPenalty = yNorm > 0.72 ? (yNorm - 0.72) * 3.0 : 0; // 0..~0.84
    const score = r.avgH * (1 + Math.log2(1 + digitsCount)) * (1 - clamp(bottomPenalty, 0, 0.75));

    if (score > best.score) best = { score, row: r };
  }

  return best.row as { cy: number; items: TokenBox[]; avgH: number };
}

function buildDigitsString(row: { cy: number; items: TokenBox[]; avgH: number }) {
  // filtra só tokens que “parecem” ser da linha grande (remove ruído menor)
  const strong = row.items.filter((t) => t.h >= row.avgH * 0.78);

  // ordena por X (esquerda -> direita)
  strong.sort((a, b) => a.minX - b.minX);

  const joined = strong.map((t) => t.text).join(" ");
  const digitsOnly = joined.replace(/[^\d]/g, "");

  return { joined, digitsOnly, used: strong };
}

function parseFuelLitersFromDigits(digitsOnly: string) {
  // regra do seu visor: "4 números grandes, sendo o último a casa decimal"
  // aceitamos também 5+ dígitos (com zeros à esquerda), sempre: inteiro = tudo menos o último, decimal = último
  if (!digitsOnly || digitsOnly.length < 3) return null;

  const dec = digitsOnly.slice(-1);
  const intPart = digitsOnly.slice(0, -1);

  const intVal = parseInt(intPart || "0", 10);
  const decVal = parseInt(dec || "0", 10);

  if (!Number.isFinite(intVal) || !Number.isFinite(decVal)) return null;

  const value = Number(`${intVal}.${decVal}`);
  // sanity: litros normalmente não explode (evita pegar linha errada)
  if (value < 0 || value > 5000) return null;

  const best_input = `${intVal},${decVal}`; // BR
  return { value, best_input };
}

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

  const auth = await getBearerToken();

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
    throw new Error(`Vision API falhou: HTTP ${res.status} - ${JSON.stringify(data)?.slice(0, 500)}`);
  }
  return data;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "").toLowerCase().trim(); // "horimetro" | "abastecimento"
    const equip = (searchParams.get("equip") || "").trim();
    const url = (searchParams.get("url") || "").trim();

    if (!kind) return jsonError("Informe ?kind=horimetro|abastecimento", 400);
    if (!url) return jsonError("Informe ?url=<signed_url>", 400);

    // baixa imagem (Supabase signed url)
    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return jsonError("Falha ao baixar imagem (signed url).", 400, { status: imgRes.status });
    }
    const buf = new Uint8Array(await imgRes.arrayBuffer());

    // OCR do Google Vision (via REST)
    const vision = await visionTextDetection(buf);
    const resp0 = vision?.responses?.[0] || {};
    const textAnnotations: VisionAnnot[] = resp0?.textAnnotations || [];

    const rawFull = (textAnnotations?.[0]?.description || "").trim();

    // tokens individuais (1..n)
    const tokens: TokenBox[] = (textAnnotations || [])
      .slice(1)
      .map(polyToBox)
      .filter(Boolean) as TokenBox[];

    const digitTokens = tokens.filter((t) => /\d/.test(t.text));

    if (!digitTokens.length) {
      return NextResponse.json({
        ok: true,
        kind,
        equip: equip || null,
        best: null,
        best_input: "",
        candidates: [],
        candidates_input: [],
        raw: rawFull,
        debug: { token_count: 0, note: "sem tokens com dígitos" },
      });
    }

    const rows = clusterRows(digitTokens);
    const bestRow = pickBestRowForBigDigits(rows);

    if (!bestRow) {
      return NextResponse.json({
        ok: true,
        kind,
        equip: equip || null,
        best: null,
        best_input: "",
        candidates: [],
        candidates_input: [],
        raw: rawFull,
        debug: { token_count: digitTokens.length, note: "não achei linha candidata" },
      });
    }

    const { joined, digitsOnly, used } = buildDigitsString(bestRow);

    let best: number | null = null;
    let best_input = "";
    let candidates: (number | null)[] = [];
    let candidates_input: string[] = [];

    if (kind === "abastecimento") {
      const parsed = parseFuelLitersFromDigits(digitsOnly);
      if (parsed) {
        best = parsed.value;
        best_input = parsed.best_input;
        candidates = [best];
        candidates_input = [best_input];
      }
    } else {
      // horímetro: mantém tudo como inteiro e coloca ",0" se não vier decimal
      // se vier 5+ dígitos, assume último é decimal (horímetro mecânico pode ter casa decimal)
      const d = digitsOnly;
      if (d.length >= 5) {
        const dec = d.slice(-1);
        const intPart = d.slice(0, -1);
        const v = Number(`${parseInt(intPart, 10)}.${parseInt(dec, 10)}`);
        if (Number.isFinite(v)) {
          best = v;
          best_input = `${parseInt(intPart, 10)},${parseInt(dec, 10)}`;
        }
      } else if (d.length >= 3) {
        const v = parseInt(d, 10);
        if (Number.isFinite(v)) {
          best = v;
          best_input = `${v},0`;
        }
      }

      candidates = best == null ? [] : [best];
      candidates_input = best == null ? [] : [best_input];
    }

    return NextResponse.json({
      ok: true,
      kind,
      equip: equip || null,
      best,
      best_input,
      candidates,
      candidates_input,
      raw: rawFull || joined,
      debug: {
        token_count: digitTokens.length,
        picked_line: joined,
        picked_digits: digitsOnly,
        row_avg_h: bestRow.avgH,
        row_cy: bestRow.cy,
        used_tokens: used.map((t) => ({
          text: t.text,
          h: t.h,
          x: [t.minX, t.maxX],
          y: [t.minY, t.maxY],
        })),
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR.", 500);
  }
}
