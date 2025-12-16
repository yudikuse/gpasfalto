// FILE: app/api/vision/ocr/route.ts
import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BBox = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  w: number;
  h: number;
  area: number;
  cx: number;
  cy: number;
};

type Token = {
  text: string;
  bbox: BBox;
};

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function clampNum(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function fmtPtBr1(value: number) {
  // sempre 1 casa decimal, sem separador de milhar
  return value.toFixed(1).replace(".", ",");
}

function digitsOnly(s: string) {
  return (s || "").replace(/[^\d]/g, "");
}

function keepNumPunct(s: string) {
  return (s || "").replace(/[^0-9.,]/g, "");
}

function hasLetters(s: string) {
  return /[A-Za-zÀ-ÿ]/.test(s || "");
}

function bboxFromPoly(poly: any): BBox | null {
  const vs = poly?.vertices || poly?.normalizedVertices;
  if (!Array.isArray(vs) || vs.length === 0) return null;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const v of vs) {
    const x = typeof v?.x === "number" ? v.x : 0;
    const y = typeof v?.y === "number" ? v.y : 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY))
    return null;

  const w = Math.max(0, maxX - minX);
  const h = Math.max(0, maxY - minY);
  const area = w * h;

  const cx = minX + w / 2;
  const cy = minY + h / 2;

  return { minX, minY, maxX, maxY, w, h, area, cx, cy };
}

function buildTokens(textAnnotations: any[]): { tokens: Token[]; W: number; H: number; raw: string } {
  const raw = textAnnotations?.[0]?.description || "";

  const tokens: Token[] = [];
  let maxX = 0;
  let maxY = 0;

  for (let i = 1; i < (textAnnotations?.length || 0); i++) {
    const t = textAnnotations[i];
    const text = String(t?.description || "").trim();
    const bbox = bboxFromPoly(t?.boundingPoly);
    if (!text || !bbox) continue;

    maxX = Math.max(maxX, bbox.maxX);
    maxY = Math.max(maxY, bbox.maxY);

    tokens.push({ text, bbox });
  }

  // fallback se vier estranho
  const W = Math.max(1, Math.round(maxX));
  const H = Math.max(1, Math.round(maxY));

  return { tokens, W, H, raw };
}

function pickHorimetro(tokens: Token[], W: number, H: number) {
  // Horímetro: janela inferior → filtra pelo "miolo" de baixo e pega o maior grupo de dígitos.
  const bottomMin = H * 0.55;

  const numeric = tokens
    .filter((t) => !hasLetters(t.text))
    .map((t) => {
      const d = digitsOnly(t.text);
      return { t, d };
    })
    .filter(({ d, t }) => d.length >= 2 && t.bbox.cy >= bottomMin);

  // score: prioriza mais dígitos, maior caixa, mais embaixo
  const scored = numeric
    .map(({ t, d }) => {
      const normArea = t.bbox.area / (W * H);
      const normH = t.bbox.h / H;
      const bottomness = t.bbox.cy / H;

      let score = 0;
      score += d.length * 10;
      score += normArea * 200;
      score += normH * 80;
      score += bottomness * 20;

      // penaliza números típicos de escala (curtos)
      const v = parseInt(d, 10);
      if (d.length <= 3 && v <= 200) score -= 20;

      return { t, d, score };
    })
    .sort((a, b) => b.score - a.score);

  const main = scored[0];
  if (!main) {
    return {
      best: null,
      best_input: null,
      candidates: [],
      candidates_input: [],
      picked: null,
    };
  }

  // inteiro do horímetro = o grupo principal (NÃO quebrar no último dígito)
  const intHours = parseInt(main.d, 10);
  if (!isFinite(intHours)) {
    return {
      best: null,
      best_input: null,
      candidates: [],
      candidates_input: [],
      picked: { main: main.d },
    };
  }

  // tenta achar o dígito decimal (um dígito) logo à direita do grupo principal
  const decCandidates = numeric
    .map(({ t, d }) => ({ t, d }))
    .filter(({ t, d }) => d.length === 1)
    .filter(({ t }) => {
      const yOk = t.bbox.cy >= main.t.bbox.minY - main.t.bbox.h * 0.6 &&
        t.bbox.cy <= main.t.bbox.maxY + main.t.bbox.h * 0.6;
      const xOk = t.bbox.minX >= main.t.bbox.maxX - main.t.bbox.w * 0.05 &&
        t.bbox.minX <= main.t.bbox.maxX + main.t.bbox.w * 1.2;
      const hOk = t.bbox.h >= main.t.bbox.h * 0.35;
      return yOk && xOk && hOk;
    })
    .map(({ t, d }) => {
      const dist = Math.abs(t.bbox.minX - main.t.bbox.maxX);
      const score = 1000 - dist + (t.bbox.area / (W * H)) * 100;
      return { t, d, score };
    })
    .sort((a, b) => b.score - a.score);

  const dec = decCandidates[0]?.d ?? "0";
  const decDigit = clampNum(parseInt(dec, 10) || 0, 0, 9);

  const best = intHours + decDigit / 10;
  const best_input = fmtPtBr1(best);

  // candidatos (pra debug)
  const candidates = [
    best,
    ...scored.slice(0, 6).map((x) => parseInt(x.d, 10)).filter((n) => isFinite(n)).map((n) => n + 0 / 10),
  ]
    .filter((n) => isFinite(n))
    .filter((v, i, a) => a.indexOf(v) === i);

  const candidates_input = candidates.map((v) => fmtPtBr1(v));

  return {
    best,
    best_input,
    candidates,
    candidates_input,
    picked: {
      mainDigits: main.d,
      decDigit: decCandidates[0]?.d ?? null,
    },
  };
}

function clusterByLine(tokens: Token[], tolY: number) {
  const sorted = [...tokens].sort((a, b) => a.bbox.cy - b.bbox.cy);
  const clusters: { cy: number; items: Token[] }[] = [];

  for (const t of sorted) {
    let placed = false;
    for (const c of clusters) {
      if (Math.abs(t.bbox.cy - c.cy) <= tolY) {
        c.items.push(t);
        // atualiza cy médio
        c.cy = c.items.reduce((s, x) => s + x.bbox.cy, 0) / c.items.length;
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push({ cy: t.bbox.cy, items: [t] });
  }
  return clusters;
}

function pickAbastecimento(tokens: Token[], W: number, H: number) {
  // Litros: pega a "linha" com dígitos maiores e monta left->right.
  const numeric = tokens
    .filter((t) => !hasLetters(t.text))
    .map((t) => ({ t, s: keepNumPunct(t.text), d: digitsOnly(t.text) }))
    .filter(({ s, d }) => s.length > 0 && d.length > 0);

  if (numeric.length === 0) {
    return { best: null, best_input: null, candidates: [], candidates_input: [], picked: null };
  }

  const maxH = Math.max(...numeric.map((x) => x.t.bbox.h));
  const big = numeric
    .filter((x) => x.t.bbox.h >= maxH * 0.6) // foca nos dígitos grandes
    .map((x) => x.t);

  const baseSet = big.length ? big : numeric.map((x) => x.t);

  const tolY = Math.max(8, maxH * 0.6, H * 0.06);
  const clusters = clusterByLine(baseSet, tolY);

  const scored = clusters
    .map((c) => {
      const areaSum = c.items.reduce((s, t) => s + t.bbox.area, 0);
      const avgH = c.items.reduce((s, t) => s + t.bbox.h, 0) / c.items.length;
      const topBias = 1.0 - (c.cy / H) * 0.15; // leve preferência por linhas mais acima
      const score = areaSum * (1 + avgH / Math.max(1, maxH)) * topBias;
      return { ...c, score };
    })
    .sort((a, b) => b.score - a.score);

  const bestLine = scored[0];
  if (!bestLine) {
    return { best: null, best_input: null, candidates: [], candidates_input: [], picked: null };
  }

  const parts = [...bestLine.items]
    .sort((a, b) => a.bbox.minX - b.bbox.minX)
    .map((t) => keepNumPunct(t.text))
    .join("");

  // limpa separadores repetidos
  let s = parts.replace(/\s+/g, "");
  s = s.replace(/,+/g, ",").replace(/\.+/g, ".");
  s = s.replace(/^[.,]+/, "").replace(/[.,]+$/, "");

  // se veio algo tipo "031" (perdeu o decimal), assume que faltou o último dígito e completa com 0
  const onlyDigits = digitsOnly(s);
  const hasSep = s.includes(",") || s.includes(".");
  let normalized = s;

  if (!hasSep && onlyDigits.length === 3) {
    normalized = onlyDigits + "0"; // 031 -> 0310 => 31,0
  } else if (!hasSep && onlyDigits.length >= 2) {
    normalized = onlyDigits;
  } else if (hasSep) {
    normalized = s;
  }

  let best: number | null = null;

  if (normalized.includes(",") || normalized.includes(".")) {
    const firstSep = normalized.includes(",") ? "," : ".";
    const [a, b] = normalized.split(firstSep);
    const intPart = digitsOnly(a);
    const decPart = digitsOnly(b || "").slice(0, 1);
    if (intPart.length >= 1) {
      const i = parseInt(intPart, 10);
      const d = clampNum(parseInt(decPart || "0", 10) || 0, 0, 9);
      best = i + d / 10;
    }
  } else {
    const d = digitsOnly(normalized);
    if (d.length >= 2) {
      const intStr = d.slice(0, -1);
      const decStr = d.slice(-1);
      const i = parseInt(intStr, 10);
      const dec = clampNum(parseInt(decStr, 10) || 0, 0, 9);
      if (isFinite(i)) best = i + dec / 10;
    }
  }

  if (best === null || !isFinite(best)) {
    return {
      best: null,
      best_input: null,
      candidates: [],
      candidates_input: [],
      picked: { line: parts, normalized },
    };
  }

  const best_input = fmtPtBr1(best);

  return {
    best,
    best_input,
    candidates: [best],
    candidates_input: [best_input],
    picked: {
      line: parts,
      normalized,
      usedMaxH: maxH,
    },
  };
}

async function getGcpAccessToken() {
  const b64 =
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GCP_KEY_BASE64 || // fallback (se existir)
    "";

  if (!b64) throw new Error("Env GCP_SA_KEY_BASE64 não configurada.");

  const json = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
  const auth = new GoogleAuth({
    credentials: json,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const tok = await client.getAccessToken();
  const token = typeof tok === "string" ? tok : tok?.token;
  if (!token) throw new Error("Falha ao obter access_token do Google.");
  return token;
}

async function visionTextDetect(base64: string) {
  const token = await getGcpAccessToken();

  const body = {
    requests: [
      {
        image: { content: base64 },
        features: [{ type: "TEXT_DETECTION", maxResults: 50 }],
        imageContext: {
          languageHints: ["pt", "en"],
        },
      },
    ],
  };

  const r = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });

  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const msg =
      j?.error?.message ||
      j?.responses?.[0]?.error?.message ||
      `Vision API HTTP ${r.status}`;
    throw new Error(msg);
  }

  return j;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const kind = (searchParams.get("kind") || "").toLowerCase();
  const url = searchParams.get("url") || "";
  const equip = (searchParams.get("equip") || "").toUpperCase() || null;

  if (!url) return jsonError("Parâmetro 'url' é obrigatório.", 400);
  if (kind !== "horimetro" && kind !== "abastecimento" && kind !== "odometro") {
    return jsonError("Parâmetro 'kind' inválido (use horimetro | abastecimento | odometro).", 400);
  }

  try {
    const imgRes = await fetch(url, { cache: "no-store" });
    if (!imgRes.ok) {
      return jsonError("Não consegui baixar a imagem (url inválida/expirada).", 400, {
        status: imgRes.status,
      });
    }

    const ab = await imgRes.arrayBuffer();
    const base64 = Buffer.from(ab).toString("base64");

    const vision = await visionTextDetect(base64);
    const ann = vision?.responses?.[0] || {};
    const textAnnotations = ann?.textAnnotations || [];
    const { tokens, W, H, raw } = buildTokens(textAnnotations);

    let out:
      | ReturnType<typeof pickHorimetro>
      | ReturnType<typeof pickAbastecimento>;

    if (kind === "horimetro") out = pickHorimetro(tokens, W, H);
    else out = pickAbastecimento(tokens, W, H);

    return NextResponse.json({
      ok: true,
      kind,
      equip,
      best: out.best,
      best_input: out.best_input,
      candidates: out.candidates,
      candidates_input: out.candidates_input,
      raw,
      debug: {
        token_count: tokens.length,
        imgW: W,
        imgH: H,
        picked: (out as any).picked ?? null,
      },
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro no OCR.", 500);
  }
}
