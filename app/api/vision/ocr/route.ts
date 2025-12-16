import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Kind = "abastecimento" | "horimetro" | "odometro" | "placa";

type Token = {
  raw: string;
  digits: string;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
  w: number;
  h: number;
  xCenter: number;
  yCenter: number;
};

function j(data: any, status = 200) {
  return NextResponse.json(data, { status });
}

function mustEnv(name: string, value: string | undefined) {
  if (!value) throw new Error(`ENV ausente: ${name}`);
  return value;
}

function loadServiceAccountCredentials() {
  // você já usava isso antes
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_BASE64 ||
    "";

  if (!b64) return null;

  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

async function visionTextDetection(imageBase64: string) {
  const credentials = loadServiceAccountCredentials();
  if (!credentials) {
    throw new Error(
      "Service Account não configurado. Defina GCP_KEY_BASE64 (JSON em base64)."
    );
  }

  const auth = new GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });

  const client = await auth.getClient();
  const headers = await client.getRequestHeaders();

  const resp = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      requests: [
        {
          image: { content: imageBase64 },
          features: [{ type: "TEXT_DETECTION" }],
        },
      ],
    }),
  });

  if (!resp.ok) {
    const t = await resp.text().catch(() => "");
    throw new Error(`Vision API ${resp.status}: ${t.slice(0, 400)}`);
  }

  const json = await resp.json();
  return json?.responses?.[0] ?? {};
}

function bboxFromVertices(vertices: any[] | undefined) {
  if (!vertices || vertices.length === 0) return null;

  const xs = vertices.map((v) => (typeof v?.x === "number" ? v.x : 0));
  const ys = vertices.map((v) => (typeof v?.y === "number" ? v.y : 0));

  const x1 = Math.min(...xs);
  const x2 = Math.max(...xs);
  const y1 = Math.min(...ys);
  const y2 = Math.max(...ys);

  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);

  return { x1, x2, y1, y2, w, h };
}

function extractTokens(visionResp: any): { tokens: Token[]; rawText: string } {
  const rawText =
    visionResp?.fullTextAnnotation?.text ||
    visionResp?.textAnnotations?.[0]?.description ||
    "";

  const ann = Array.isArray(visionResp?.textAnnotations)
    ? visionResp.textAnnotations
    : [];

  const tokens: Token[] = [];

  // ann[0] é o texto inteiro; a partir do 1 são os “pedaços” com bounding box
  for (let i = 1; i < ann.length; i++) {
    const a = ann[i];
    const raw = String(a?.description ?? "");
    const digits = raw.replace(/\D/g, "");
    if (!digits) continue;

    const bb = bboxFromVertices(a?.boundingPoly?.vertices);
    if (!bb) continue;

    tokens.push({
      raw,
      digits,
      x1: bb.x1,
      x2: bb.x2,
      y1: bb.y1,
      y2: bb.y2,
      w: bb.w,
      h: bb.h,
      xCenter: bb.x1 + bb.w / 2,
      yCenter: bb.y1 + bb.h / 2,
    });
  }

  return { tokens, rawText };
}

function clusterByY(tokens: Token[], tolerance: number) {
  const sorted = [...tokens].sort((a, b) => a.yCenter - b.yCenter);
  const groups: Token[][] = [];

  for (const t of sorted) {
    const last = groups[groups.length - 1];
    if (!last) {
      groups.push([t]);
      continue;
    }
    const lastMean =
      last.reduce((acc, x) => acc + x.yCenter, 0) / last.length;

    if (Math.abs(t.yCenter - lastMean) <= tolerance) last.push(t);
    else groups.push([t]);
  }

  return groups;
}

function pickAbastecimento(tokens: Token[]) {
  if (!tokens.length) return { best: null as number | null, best_input: "", debug: { reason: "no_tokens" } };

  const maxH = Math.max(...tokens.map((t) => t.h));
  // grande costuma ser MUITO maior que o contador de baixo
  const big = tokens.filter((t) => t.h >= maxH * 0.65);

  const used = big.length ? big : tokens; // fallback

  const tol = maxH * 0.6;
  const groups = clusterByY(used, tol);

  // escolhe o cluster com mais itens; empate -> maior altura média
  const ranked = groups
    .map((g) => {
      const avgH = g.reduce((acc, t) => acc + t.h, 0) / g.length;
      return { g, count: g.length, avgH };
    })
    .sort((a, b) => (b.count - a.count) || (b.avgH - a.avgH));

  const chosen = ranked[0]?.g ?? [];
  const chosenSorted = [...chosen].sort((a, b) => a.x1 - b.x1);

  // concatena dígitos da linha grande (normalmente vira "0310")
  let digitsStr = chosenSorted.map((t) => t.digits).join("");

  // às vezes o OCR perde o zero da esquerda (ex.: "310") -> força 4 dígitos
  if (digitsStr.length === 3) digitsStr = digitsStr.padStart(4, "0");

  // se vier maior que 4 (raramente), pega a primeira sequência de 4
  const m = digitsStr.match(/\d{4}/);
  const d4 = m ? m[0] : "";

  if (!d4) {
    return {
      best: null,
      best_input: "",
      debug: {
        reason: "no_4_digits",
        maxH,
        tokens: tokens.length,
        used: used.length,
        chosen: chosenSorted.map((t) => ({ raw: t.raw, digits: t.digits, h: t.h, y: t.yCenter })),
        digitsStr,
      },
    };
  }

  const intPart = String(parseInt(d4.slice(0, 3), 10)); // "031" -> "31"
  const dec = d4.slice(3, 4); // último é decimal
  const best_input = `${intPart},${dec}`;
  const best = Number(`${intPart}.${dec}`);

  return {
    best,
    best_input,
    debug: {
      maxH,
      picked4: d4,
      chosen: chosenSorted.map((t) => ({ raw: t.raw, digits: t.digits, h: t.h, y: t.yCenter })),
      digitsStr,
    },
  };
}

function pickHorimetro(tokens: Token[]) {
  if (!tokens.length) return { best: null as number | null, best_input: "", debug: { reason: "no_tokens" } };

  // prioriza “tokens longos” (>=4 dígitos) p/ não cair em 60/70/110 do mostrador
  const long = tokens.filter((t) => t.digits.length >= 4);

  const base = long.length ? long : tokens;

  const chosen = [...base].sort((a, b) => (b.h - a.h) || (b.digits.length - a.digits.length))[0];

  let d = chosen?.digits ?? "";
  if (!d) {
    return { best: null, best_input: "", debug: { reason: "no_digits" } };
  }

  // comum vir "03647"
  if (d.length === 5 && d.startsWith("0")) d = d.slice(1);

  const main = parseInt(d, 10);
  if (!Number.isFinite(main)) {
    return { best: null, best_input: "", debug: { reason: "nan", d } };
  }

  const best = main;
  const best_input = `${main},0`; // mantém 1 casa (como você já está usando)

  return {
    best,
    best_input,
    debug: {
      picked: { raw: chosen.raw, digits: chosen.digits, h: chosen.h, y: chosen.yCenter },
      normalized: d,
    },
  };
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const kind = (u.searchParams.get("kind") || "").toLowerCase() as Kind;
    const equip = u.searchParams.get("equip") || null;
    const url = u.searchParams.get("url");

    if (!kind) return j({ ok: false, error: "Param obrigatório: kind" }, 400);
    if (!url) return j({ ok: false, error: "Param obrigatório: url" }, 400);

    const imgResp = await fetch(url, { cache: "no-store" });
    if (!imgResp.ok) {
      return j(
        { ok: false, kind, equip, error: `Falha ao baixar imagem: ${imgResp.status}` },
        400
      );
    }

    const buf = Buffer.from(await imgResp.arrayBuffer());
    const b64 = buf.toString("base64");

    const vision = await visionTextDetection(b64);
    const { tokens, rawText } = extractTokens(vision);

    let best: number | null = null;
    let best_input = "";
    let pickedDebug: any = null;

    if (kind === "abastecimento") {
      const r = pickAbastecimento(tokens);
      best = r.best;
      best_input = r.best_input;
      pickedDebug = r.debug;
    } else if (kind === "horimetro") {
      const r = pickHorimetro(tokens);
      best = r.best;
      best_input = r.best_input;
      pickedDebug = r.debug;
    } else {
      // fallback simples
      const m = rawText.replace(/\s+/g, " ").match(/\d+/);
      if (m) {
        best = Number(m[0]);
        best_input = m[0];
      }
      pickedDebug = { reason: "fallback", match: m?.[0] ?? null };
    }

    if (best == null || !best_input) {
      return j({
        ok: false,
        kind,
        equip,
        best: null,
        best_input: "",
        candidates: [],
        candidates_input: [],
        raw: rawText,
        debug: {
          token_count: tokens.length,
          picked: pickedDebug,
        },
      });
    }

    return j({
      ok: true,
      kind,
      equip,
      best,
      best_input,
      candidates: [best],
      candidates_input: [best_input],
      raw: rawText,
      debug: {
        token_count: tokens.length,
        picked: pickedDebug,
      },
    });
  } catch (err: any) {
    console.error("OCR /api/vision/ocr error:", err);
    return j({ ok: false, error: err?.message || "Erro inesperado" }, 500);
  }
}
