import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function resolveServiceAccount() {
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GOOGLE_CREDENTIALS_BASE64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    "";

  if (!b64) return null;

  const raw = Buffer.from(b64, "base64").toString("utf-8");
  const sa = JSON.parse(raw);

  // chave costuma vir com \n escapado
  if (sa?.private_key && typeof sa.private_key === "string") {
    sa.private_key = sa.private_key.replace(/\\n/g, "\n");
  }
  return sa;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    return res;
  } finally {
    clearTimeout(t);
  }
}

type Token = {
  text: string;
  digits: string; // só dígitos
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

function bboxFromVertices(vertices: any[] | undefined) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const v of vertices || []) {
    const x = typeof v?.x === "number" ? v.x : 0;
    const y = typeof v?.y === "number" ? v.y : 0;
    xs.push(x);
    ys.push(y);
  }
  const x0 = xs.length ? Math.min(...xs) : 0;
  const y0 = ys.length ? Math.min(...ys) : 0;
  const x1 = xs.length ? Math.max(...xs) : 0;
  const y1 = ys.length ? Math.max(...ys) : 0;
  return { x0, y0, x1, y1, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
}

function toPtNumber(value: number, decimals = 1) {
  return value.toFixed(decimals).replace(".", ",");
}

/**
 * Agrupa tokens em “linhas” por proximidade vertical (cy)
 */
function groupByRows(tokens: Token[], imgH: number) {
  const yTol = Math.max(18, Math.round(imgH * 0.03)); // ~3% altura, mínimo 18px
  const sorted = [...tokens].sort((a, b) => a.cy - b.cy);

  const rows: { tokens: Token[]; cyAvg: number }[] = [];

  for (const t of sorted) {
    const last = rows[rows.length - 1];
    if (!last || Math.abs(t.cy - last.cyAvg) > yTol) {
      rows.push({ tokens: [t], cyAvg: t.cy });
    } else {
      last.tokens.push(t);
      last.cyAvg =
        last.tokens.reduce((acc, x) => acc + x.cy, 0) / last.tokens.length;
    }
  }

  // ordena tokens dentro da linha por X e monta “digits”
  return rows.map((r) => {
    const ts = [...r.tokens].sort((a, b) => a.cx - b.cx);
    const digits = ts.map((t) => t.digits).join("");
    const x0 = Math.min(...ts.map((t) => t.x0));
    const y0 = Math.min(...ts.map((t) => t.y0));
    const x1 = Math.max(...ts.map((t) => t.x1));
    const y1 = Math.max(...ts.map((t) => t.y1));
    const meanH = ts.reduce((acc, t) => acc + t.h, 0) / ts.length;

    return { tokens: ts, digits, x0, y0, x1, y1, cy: r.cyAvg, meanH };
  });
}

function parseAbastecimentoFromRows(rows: any[], imgH: number) {
  // Regra: abastecimento = 4 dígitos GRANDES em cima, último dígito = casa decimal.
  // Então: escolhe a linha com MAIOR altura média (meanH). Em empate, mais “alta” na foto (menor cy).
  const candidates = rows
    .filter((r) => r.digits && r.digits.length >= 3) // 310 -> 31,0 também vale
    .map((r) => ({
      ...r,
      // penaliza linha muito baixa (normalmente os dígitos pequenos)
      penalty: r.cy > imgH * 0.80 ? 1 : 0,
    }))
    .sort((a, b) => {
      // primeiro: evitar linhas muito baixas
      if (a.penalty !== b.penalty) return a.penalty - b.penalty;
      // depois: maior altura (dígitos grandes)
      if (b.meanH !== a.meanH) return b.meanH - a.meanH;
      // depois: mais acima
      return a.cy - b.cy;
    });

  const picked = candidates[0] || null;
  if (!picked) return null;

  const digits = picked.digits;

  // último dígito é decimal
  const intPartRaw = digits.slice(0, -1);
  const decRaw = digits.slice(-1);

  const intPart = (intPartRaw.replace(/^0+/, "") || "0");
  const dec = decRaw;

  const value =
    parseInt(intPart, 10) + (parseInt(dec, 10) || 0) / 10;

  return {
    value,
    best_input: toPtNumber(value, 1),
    picked_debug: {
      digits,
      intPartRaw,
      decRaw,
      row: {
        cy: Math.round(picked.cy),
        meanH: Math.round(picked.meanH),
        y0: Math.round(picked.y0),
        y1: Math.round(picked.y1),
      },
    },
  };
}

function parseHorimetroFromRows(rows: any[], imgH: number) {
  // Regra prática: horímetro tem um “bloco” com 4–6 dígitos (muitas vezes com zero à esquerda),
  // e (às vezes) um dígito decimal separado em uma janelinha.
  // Então: pega a linha com MAIS dígitos (>=4) e com dígitos “maiores” (meanH).
  const mainCand = rows
    .filter((r) => r.digits && r.digits.length >= 4)
    .sort((a, b) => {
      if (b.digits.length !== a.digits.length) return b.digits.length - a.digits.length;
      if (b.meanH !== a.meanH) return b.meanH - a.meanH;
      // tende a estar mais “embaixo” no mostrador
      return b.cy - a.cy;
    })[0];

  if (!mainCand) return null;

  const mainDigits = mainCand.digits.replace(/^0+/, "") || "0";
  const mainInt = parseInt(mainDigits, 10) || 0;

  // tenta achar um dígito decimal “próximo” (abaixo do bloco principal)
  // (procura tokens de 1 dígito com cy um pouco maior que a linha principal e X dentro do range)
  const x0 = mainCand.x0;
  const x1 = mainCand.x1;
  const y1 = mainCand.y1;

  const oneDigitTokens = mainCand.tokens
    .flatMap(() => []) as Token[]; // placeholder (mantém tipagem)

  // A gente não tem as outras linhas aqui? Temos:
  // vamos varrer todas as linhas e pegar tokens de 1 dígito.
  const allOneDigits: Token[] = [];
  for (const r of rows) {
    for (const t of r.tokens as Token[]) {
      if (t.digits && t.digits.length === 1) allOneDigits.push(t);
    }
  }

  const decToken = allOneDigits
    .filter((t) => t.cx >= x0 && t.cx <= x1 && t.cy >= y1 - 10 && t.cy <= y1 + imgH * 0.12)
    .sort((a, b) => a.cy - b.cy)[0];

  const decDigit = decToken?.digits ?? null;
  const value = decDigit ? mainInt + (parseInt(decDigit, 10) || 0) / 10 : mainInt;

  return {
    value,
    best_input: toPtNumber(value, 1),
    picked_debug: {
      mainDigits: mainCand.digits,
      mainInt,
      decDigit,
      mainRow: {
        cy: Math.round(mainCand.cy),
        meanH: Math.round(mainCand.meanH),
        y0: Math.round(mainCand.y0),
        y1: Math.round(mainCand.y1),
      },
      decBox: decToken
        ? { x0: Math.round(decToken.x0), y0: Math.round(decToken.y0), h: Math.round(decToken.h) }
        : null,
    },
  };
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const kind = (searchParams.get("kind") || "").toLowerCase();
  const equip = searchParams.get("equip") || null;
  const url = searchParams.get("url") || "";

  if (!kind || (kind !== "horimetro" && kind !== "abastecimento")) {
    return jsonError("kind inválido (use horimetro|abastecimento)", 400);
  }
  if (!url) return jsonError("url obrigatório", 400);

  const sa = resolveServiceAccount();
  if (!sa) {
    return jsonError(
      "Credenciais Google ausentes. Defina GCP_KEY_BASE64 (JSON do service account em base64).",
      500
    );
  }

  // 1) baixa imagem
  const imgRes = await fetchWithTimeout(url, { method: "GET" }, 20000);
  if (!imgRes.ok) {
    return jsonError("Falha ao baixar imagem", 400, {
      status: imgRes.status,
    });
  }
  const buf = Buffer.from(await imgRes.arrayBuffer());
  const b64 = buf.toString("base64");

  // 2) chama Google Vision via REST
  const auth = new GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();

  const visionBody = {
    requests: [
      {
        image: { content: b64 },
        features: [{ type: "TEXT_DETECTION" }],
        imageContext: { languageHints: ["pt", "en"] },
      },
    ],
  };

  const visionRes = await fetchWithTimeout(
    "https://vision.googleapis.com/v1/images:annotate",
    {
      method: "POST",
      headers: {
        ...(headers as any),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(visionBody),
    },
    25000
  );

  if (!visionRes.ok) {
    const txt = await visionRes.text().catch(() => "");
    return jsonError("Falha no Google Vision", 500, {
      status: visionRes.status,
      details: txt?.slice(0, 500),
    });
  }

  const data: any = await visionRes.json();
  const ann = data?.responses?.[0]?.textAnnotations || [];
  const rawText = ann?.[0]?.description || "";

  // tokens numéricos com bbox
  const tokens: Token[] = [];
  for (let i = 1; i < ann.length; i++) {
    const t = ann[i];
    const text = String(t?.description || "");
    const digits = text.replace(/\D/g, "");
    if (!digits) continue;

    const { x0, y0, x1, y1, w, h } = bboxFromVertices(t?.boundingPoly?.vertices);
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;

    tokens.push({ text, digits, x0, y0, x1, y1, w, h, cx, cy });
  }

  // estima tamanho da imagem pelos bbox (bom o suficiente p/ heurística)
  const imgW = Math.max(1, ...tokens.map((t) => t.x1));
  const imgH = Math.max(1, ...tokens.map((t) => t.y1));

  const rows = groupByRows(tokens, imgH);

  let parsed:
    | { value: number; best_input: string; picked_debug: any }
    | null = null;

  if (kind === "abastecimento") {
    parsed = parseAbastecimentoFromRows(rows, imgH);
  } else {
    parsed = parseHorimetroFromRows(rows, imgH);
  }

  if (!parsed) {
    return NextResponse.json({
      ok: true,
      kind,
      equip,
      best: null,
      best_input: "",
      candidates: [],
      candidates_input: [],
      raw: rawText,
      ref_horimetro: null,
      debug: { token_count: tokens.length, imgW, imgH, rows: rows.map(r => ({ digits: r.digits, cy: Math.round(r.cy), meanH: Math.round(r.meanH) })) },
    });
  }

  return NextResponse.json({
    ok: true,
    kind,
    equip,
    best: parsed.value,
    best_input: parsed.best_input,
    candidates: [parsed.value],
    candidates_input: [parsed.best_input],
    raw: rawText,
    ref_horimetro: null,
    debug: {
      token_count: tokens.length,
      imgW,
      imgH,
      picked: parsed.picked_debug,
      rows: rows
        .filter((r) => r.digits)
        .slice(0, 12)
        .map((r) => ({
          digits: r.digits,
          cy: Math.round(r.cy),
          meanH: Math.round(r.meanH),
          y0: Math.round(r.y0),
          y1: Math.round(r.y1),
        })),
    },
  });
}
