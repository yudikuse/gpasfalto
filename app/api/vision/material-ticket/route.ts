// FILE: app/api/vision/material-ticket/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json(
    { ok: false, error: message, ...(extra ? { extra } : {}) },
    { status }
  );
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
      "Falha ao ler o service account. Verifique o base64 do JSON em GCP_KEY_BASE64 (ou GOOGLE_SERVICE_ACCOUNT_B64)."
    );
  }
}

async function getVisionAuth() {
  const apiKey =
    process.env.GCP_VISION_API_KEY || process.env.GOOGLE_VISION_API_KEY || "";

  if (apiKey) return { mode: "apikey" as const, apiKey };

  const creds = resolveServiceAccount();
  if (!creds) {
    throw new Error(
      "Sem credenciais: configure GCP_VISION_API_KEY (ou GOOGLE_VISION_API_KEY) ou GCP_KEY_BASE64."
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

async function visionTextDetection(imageBytes: Buffer) {
  const auth = await getVisionAuth();

  const endpointBase = "https://vision.googleapis.com/v1/images:annotate";
  const endpoint =
    auth.mode === "apikey" ? `${endpointBase}?key=${auth.apiKey}` : endpointBase;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.mode === "bearer") headers.Authorization = `Bearer ${auth.token}`;

  const body = {
    requests: [
      {
        image: { content: imageBytes.toString("base64") },
        features: [{ type: "TEXT_DETECTION" }],
        imageContext: { languageHints: ["pt", "pt-BR"] },
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    cache: "no-store",
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Vision API falhou (${res.status}). ${t?.slice(0, 300)}`);
  }

  return res.json();
}

function toUpperLines(raw: string) {
  const lines = (raw || "")
    .split(/\r?\n/g)
    .map((l) => l.trim())
    .filter(Boolean);
  const upper = lines.map((l) => l.toUpperCase());
  return { lines, upper };
}

const PLATE_RE = /\b[A-Z]{3}-[A-Z0-9]{4}\b/g; // GWI-3J50, KGX-6I47
const EQUIP_RE = /\b[A-Z]{1,3}-\d{2}\b/g; // CE-02, EH-02, PC-04
const DATE_RE = /\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/g;
const TIME_RE = /\b([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g;

// aceita 10.200 / 10,200 / 10/200
const WEIGHT_TOKEN_RE = /\b\d{1,3}[.,\/]\d{3}\b/g;

function looksLikeVehicle(s: string) {
  const v = (s || "").toUpperCase().trim();
  if (!v) return false;
  return /\b[A-Z]{3}-[A-Z0-9]{4}\b/.test(v) || /\b[A-Z]{1,3}-\d{2}\b/.test(v);
}

function pickVehicleFromContext(rawFull: string, upperLines: string[]) {
  const idx = upperLines.findIndex(
    (l) => l.includes("VEIC") || l.includes("VEIC/CAVALO") || l.includes("VEÍC")
  );

  const windowText =
    idx >= 0 ? upperLines.slice(idx, idx + 6).join(" ") : "";

  const m1 = windowText.match(PLATE_RE)?.[0] || null;
  if (m1) return m1;

  const m2 = windowText.match(EQUIP_RE)?.[0] || null;
  if (m2) return m2;

  const allPlate = rawFull.toUpperCase().match(PLATE_RE)?.[0] || null;
  if (allPlate) return allPlate;

  const allEquip = rawFull.toUpperCase().match(EQUIP_RE)?.[0] || null;
  if (allEquip) return allEquip;

  return null;
}

function normalizeDateToBRShort(dd: string, mm: string, yy: string) {
  const y = yy.length === 2 ? yy : yy.slice(-2);
  return `${dd}/${mm}/${y}`;
}

function isValidDate(dd: number, mm: number, yyyy: number) {
  if (mm < 1 || mm > 12) return false;
  if (dd < 1 || dd > 31) return false;

  const d = new Date(yyyy, mm - 1, dd);
  return (
    d.getFullYear() === yyyy &&
    d.getMonth() === mm - 1 &&
    d.getDate() === dd
  );
}

function pickBestDate(rawFull: string, upperLines: string[]) {
  const matches = [...rawFull.matchAll(DATE_RE)].map((m) => ({
    dd: m[1],
    mm: m[2],
    yy: m[3],
  }));

  if (!matches.length) return { dataBr: null as string | null, debug: matches };

  // preferir uma data válida perto da seção REAL "PESAGEM FINAL" (não o "OK.")
  const idxFinal = upperLines.findIndex(
    (l) => l.includes("PESAGEM FINAL") && !l.includes("OK")
  );

  if (idxFinal >= 0) {
    const window = upperLines.slice(idxFinal, idxFinal + 12).join("\n");
    const windowMatches = [...window.matchAll(DATE_RE)].map((m) => ({
      dd: m[1],
      mm: m[2],
      yy: m[3],
    }));

    for (const m of windowMatches) {
      const dd = Number(m.dd);
      const mm = Number(m.mm);
      let yyyy = Number(m.yy);
      if (m.yy.length === 2) yyyy = yyyy <= 69 ? 2000 + yyyy : 1900 + yyyy;
      if (isValidDate(dd, mm, yyyy)) {
        return {
          dataBr: normalizeDateToBRShort(m.dd, m.mm, m.yy),
          debug: matches,
        };
      }
    }
  }

  // fallback: primeira data válida do documento
  for (const m of matches) {
    const dd = Number(m.dd);
    const mm = Number(m.mm);
    let yyyy = Number(m.yy);
    if (m.yy.length === 2) yyyy = yyyy <= 69 ? 2000 + yyyy : 1900 + yyyy;
    if (isValidDate(dd, mm, yyyy)) {
      return {
        dataBr: normalizeDateToBRShort(m.dd, m.mm, m.yy),
        debug: matches,
      };
    }
  }

  // se todas inválidas, devolve a primeira mesmo (só pra debug)
  const first = matches[0];
  return {
    dataBr: normalizeDateToBRShort(first.dd, first.mm, first.yy),
    debug: matches,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function parseWeightToken(tok: string): number | null {
  // 10/200 -> 10.200
  const s = (tok || "").trim().replace("/", ".").replace(",", ".");
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function extractWeightsByLine(lines: string[]) {
  const all: { value: number; lineIdx: number; token: string }[] = [];

  lines.forEach((line, idx) => {
    const toks = line.match(WEIGHT_TOKEN_RE) || [];
    for (const t of toks) {
      const v = parseWeightToken(t);
      if (v !== null && v > 0) all.push({ value: round3(v), lineIdx: idx, token: t });
    }
  });

  return all;
}

function pickWeightFromSection(
  weights: { value: number; lineIdx: number }[],
  fromIdx: number,
  window = 10
) {
  if (fromIdx < 0) return null;
  const w = weights.find((x) => x.lineIdx >= fromIdx && x.lineIdx <= fromIdx + window);
  return w?.value ?? null;
}

function pickStandaloneWeight(linesUpper: string[], weights: { value: number; lineIdx: number }[]) {
  // linha só com o número (ex.: "2.880")
  for (const w of weights) {
    const l = (linesUpper[w.lineIdx] || "").trim();
    if (l.match(/^\d{1,3}[.,\/]\d{3}$/)) return w.value;
  }
  return null;
}

function pickNetWeightSmart(rawFull: string) {
  const { lines, upper } = toUpperLines(rawFull);
  const weights = extractWeightsByLine(lines);

  const idxInicial = upper.findIndex((l) => l.includes("PESAGEM INICIAL"));
  const idxFinal = upper.findIndex(
    (l) => l.includes("PESAGEM FINAL") && !l.includes("OK")
  );

  const wInicial = pickWeightFromSection(weights, idxInicial + 1, 12);
  const wFinal = pickWeightFromSection(weights, idxFinal + 1, 14);

  // quando o líquido aparece impresso sozinho (normal)
  const standalone = pickStandaloneWeight(upper, weights);

  // se temos inicial+final, líquido = final - inicial
  if (wInicial !== null && wFinal !== null) {
    const diff = round3(Math.abs(wFinal - wInicial));
    return {
      peso_t: diff,
      peso_mask: diff.toFixed(3),
      debug: {
        pesos_tokens: weights.map((x) => x.token),
        pesos_vals: weights.map((x) => x.value),
        w_inicial: wInicial,
        w_final: wFinal,
        w_standalone: standalone,
        escolhido: diff,
        modo: "diff(final-inicial)",
      },
    };
  }

  // se não achou seções, mas existe líquido standalone
  if (standalone !== null) {
    const v = round3(standalone);
    return {
      peso_t: v,
      peso_mask: v.toFixed(3),
      debug: {
        pesos_tokens: weights.map((x) => x.token),
        pesos_vals: weights.map((x) => x.value),
        w_inicial: wInicial,
        w_final: wFinal,
        w_standalone: standalone,
        escolhido: v,
        modo: "standalone",
      },
    };
  }

  // fallback por combinação (13.080 - 10.200 = 2.880)
  const nums = Array.from(new Set(weights.map((x) => x.value))).sort((a, b) => a - b);
  if (!nums.length) {
    return { peso_t: null, peso_mask: null, debug: { modo: "none", pesos: [] } };
  }

  const tol = 0.001;
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      if (nums[i] <= nums[j]) continue;
      const diff = round3(nums[i] - nums[j]);
      const has = nums.some((x) => Math.abs(x - diff) <= tol);
      if (has && diff > 0) {
        return {
          peso_t: diff,
          peso_mask: diff.toFixed(3),
          debug: { modo: "combo", nums, escolhido: diff },
        };
      }
    }
  }

  // última: max-min
  const diff = round3(nums[nums.length - 1] - nums[0]);
  return {
    peso_t: diff > 0 ? diff : null,
    peso_mask: diff > 0 ? diff.toFixed(3) : null,
    debug: { modo: "max-min", nums, escolhido: diff },
  };
}

function fixCommonOCR(s: string, rawUpperFull: string) {
  let out = (s || "").trim().replace(/\s+/g, " ");

  // PATIO GRA -> PATIO GPA (quando o ticket contém GPA)
  if (/\bPATIO\b/.test(out) && /\bGRA\b/.test(out) && rawUpperFull.includes("GPA")) {
    out = out.replace(/\bGRA\b/g, "GPA");
  }

  return out;
}

function isNoiseLine(l: string) {
  if (!l) return true;
  const x = l.toUpperCase().trim();

  // ruídos / cabeçalhos
  const banned = [
    "TICKET",
    "TICKET DE PESAGEM",
    "PESAGEM FINAL OK",
    "PESAGEM FINAL OK.",
    "PESAGEM FINAL",
    "PESAGEM INICIAL",
    "VEC/CAVALO",
    "VEIC/CAVALO",
    "VEIC",
    "VEÍC",
    "MOTORISTA",
    "ASSINATURA",
    "RECEBIMENTO",
    "INSPE",
    "OBS",
    "P. GERAL",
    "P. OBRA",
    "DATA", // <- CRÍTICO: não deixa virar "material"
    "EAM",
  ];
  if (banned.some((b) => x === b || x.includes(b))) return true;

  // topo institucional
  if (x.includes("CONSTRU") || x.includes("LTDA")) return true;

  // datas/horas/pesos isolados
  if (x.match(DATE_RE)) return true;
  if (x.match(TIME_RE)) return true;
  if (x.match(WEIGHT_TOKEN_RE)) return true;

  // caixas soltas
  if (x === "UA-01" || x === "UA-03" || x === "X") return true;

  // só número
  if (/^\d+$/.test(x)) return true;

  return false;
}

function assignTriplet(cands: string[]) {
  const materialHints = [
    "MASSA",
    "CBUQ",
    "RR",
    "DILUID",
    "FUNDO",
    "TAPA",
    "BURACO",
    "ASFALTO",
    "RAP",
    "CAP",
    "EMULS",
    "BRITA",
  ];

  // ORIGEM: preferir GPA ENGENHARIA, senão USINA..., senão primeiro
  let oi = cands.findIndex((c) => c.includes("GPA ENGENHARIA"));
  if (oi < 0) oi = cands.findIndex((c) => c.startsWith("USINA"));
  if (oi < 0) oi = 0;

  const origem = cands[oi] || null;
  const rest1 = cands.filter((_, i) => i !== oi);

  // DESTINO: preferir CARGILL, senão PATIO, senão primeiro
  let di = rest1.findIndex((c) => c.includes("CARGILL"));
  if (di < 0) di = rest1.findIndex((c) => c.includes("PATIO"));
  if (di < 0) di = 0;

  const destino = rest1[di] || null;
  const rest2 = rest1.filter((_, i) => i !== di);

  // MATERIAL: preferir por palavras-chave
  let mi = rest2.findIndex((c) => materialHints.some((h) => c.includes(h)));
  if (mi < 0) mi = 0;

  const material = rest2[mi] || null;

  return { origem, destino, material };
}

function parseTicketFields(rawFull: string) {
  const { lines, upper } = toUpperLines(rawFull);
  const rawUpperFull = rawFull.toUpperCase();

  const veiculo = pickVehicleFromContext(rawFull, upper);

  const datePick = pickBestDate(rawFull, upper);
  const dataBr = datePick.dataBr;

  const timeMatches = rawFull.match(TIME_RE) || [];
  const horario = timeMatches[0] || null;

  const pesoPick = pickNetWeightSmart(rawFull);
  const peso_t = pesoPick.peso_t;
  const peso_mask = pesoPick.peso_mask;

  // candidatos textuais (origem/destino/material)
  const candidatesRaw: string[] = [];
  for (const l of upper) {
    const v = l.trim();
    if (!v) continue;
    if (isNoiseLine(v)) continue;
    if (looksLikeVehicle(v)) continue;

    // evita igual ao veículo
    if (veiculo) {
      const a = v.replace(/[^A-Z0-9]/g, "");
      const b = veiculo.replace(/[^A-Z0-9]/g, "");
      if (a && b && (a === b || a.includes(b) || b.includes(a))) continue;
    }

    // precisa ter letra
    if (!/[A-Z]/.test(v)) continue;

    candidatesRaw.push(v);
  }

  // normaliza + corrige
  const normalized = candidatesRaw.map((s) => fixCommonOCR(s, rawUpperFull));

  // remove duplicatas mantendo ordem
  const seen = new Set<string>();
  const cands: string[] = [];
  for (const p of normalized) {
    const k = p.replace(/\s+/g, " ").trim();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    cands.push(k);
  }

  const triplet = assignTriplet(cands);

  const clean = (s: string | null) => (s ? s.replace(/\s+/g, " ").trim() : null);

  return {
    veiculo: clean(veiculo),
    origem: clean(triplet.origem),
    destino: clean(triplet.destino),
    material: clean(triplet.material),
    data_br: dataBr,
    horario,
    peso_t,
    peso_mask,
    debug: {
      date_candidates: datePick.debug,
      time_candidates: timeMatches,
      candidates_raw: candidatesRaw.slice(0, 20),
      candidates_final: cands.slice(0, 10),
      peso: pesoPick.debug,
      lines_sample: lines.slice(0, 30),
    },
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const imageBase64 = (body?.imageBase64 || "").trim();

    if (!imageBase64) {
      return jsonError("Envie { imageBase64 } (dataURL ou base64 puro).", 400);
    }

    const b64 = imageBase64.includes("base64,")
      ? imageBase64.split("base64,")[1]
      : imageBase64;

    const input = Buffer.from(b64, "base64") as Buffer;
    if (!input?.length) return jsonError("Base64 inválido.", 400);

    const processed = (await sharp(input)
      .rotate()
      .resize({ width: 1900, withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .sharpen()
      .toBuffer()) as Buffer;

    const vision = await visionTextDetection(processed);
    const resp0 = vision?.responses?.[0] || {};
    const textAnnotations = resp0?.textAnnotations || [];
    const rawFull = (textAnnotations?.[0]?.description || "").trim();

    if (!rawFull) {
      return NextResponse.json({
        ok: true,
        raw: "",
        fields: {
          veiculo: null,
          origem: null,
          destino: null,
          material: null,
          data_br: null,
          horario: null,
          peso_t: null,
          peso_mask: null,
        },
        debug: { note: "sem texto detectado" },
      });
    }

    const fields = parseTicketFields(rawFull);

    return NextResponse.json({
      ok: true,
      raw: rawFull,
      fields,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Erro inesperado no OCR do ticket.", 500);
  }
}
