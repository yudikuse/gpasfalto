// FILE: app/api/vision/material-ticket/route.ts
import { NextRequest, NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";
import sharp from "sharp";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

type SharpBuf = Buffer<ArrayBuffer>;

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

async function visionTextDetection(imageBytes: SharpBuf) {
  const auth = await getVisionAuth();

  const endpointBase = "https://vision.googleapis.com/v1/images:annotate";
  const endpoint =
    auth.mode === "apikey" ? `${endpointBase}?key=${auth.apiKey}` : endpointBase;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth.mode === "bearer") headers.Authorization = `Bearer ${auth.token}`;

  const body = {
    requests: [
      {
        image: { content: Buffer.from(imageBytes).toString("base64") },
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
const WEIGHT_RE = /\b\d{1,3}[.,/]\d{3}\b/g; // 13.080, 9,590, 10/200 (OCR)
const WEIGHT_SPACE_RE = /\b\d{1,3}\s\d{3}\b/g; // 10 200 (OCR)
const TIME_RE = /\b([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b/g;

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

function isValidDateParts(dd: number, mm: number, yy: number) {
  if (!(dd >= 1 && dd <= 31)) return false;
  if (!(mm >= 1 && mm <= 12)) return false;
  if (!(yy >= 0 && yy <= 2099)) return false;
  return true;
}

function pickBestDate(rawFull: string) {
  const ms = [...rawFull.matchAll(/\b(\d{2})\/(\d{2})\/(\d{2}|\d{4})\b/g)];
  if (!ms.length) return null;

  // pega a ÚLTIMA data válida (no ticket, a válida costuma aparecer mais pro final)
  for (let i = ms.length - 1; i >= 0; i--) {
    const dd = Number(ms[i][1]);
    const mm = Number(ms[i][2]);
    const yyRaw = ms[i][3];
    const yy = yyRaw.length === 2 ? Number(`20${yyRaw}`) : Number(yyRaw);
    if (isValidDateParts(dd, mm, yy)) {
      return normalizeDateToBRShort(ms[i][1], ms[i][2], yyRaw);
    }
  }

  return null;
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}

function parseWeightToken(s: string) {
  const t = s.trim();
  // trata "10/200" e "9,590" e "13.080" e "10 200"
  const normalized = t
    .replace(/\s/g, "")
    .replace("/", ".")
    .replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function pickNetWeight(values: number[]) {
  const nums = Array.from(new Set(values.map((n) => round3(n)))).sort(
    (a, b) => a - b
  );

  if (nums.length === 0) return null;
  if (nums.length === 1) return nums[0];
  if (nums.length === 2) return round3(Math.abs(nums[1] - nums[0]));

  const tol = 0.001;
  for (let i = 0; i < nums.length; i++) {
    for (let j = 0; j < nums.length; j++) {
      if (nums[i] <= nums[j]) continue;
      const diff = round3(nums[i] - nums[j]);
      const has = nums.some((x) => Math.abs(x - diff) <= tol);
      if (has) return diff;
    }
  }

  return round3(nums[nums.length - 1] - nums[0]);
}

function fixCommonOcr(s: string) {
  let x = (s || "").replace(/\s+/g, " ").trim();

  // correção típica: PATIO GRA -> PATIO GPA (OCR confunde P com R)
  x = x.replace(/\bPATIO\s+GRA\b/gi, "PATIO GPA");

  return x;
}

function extractCodedTriplet(upper: string[], veiculo: string | null) {
  const codedRaw: string[] = [];

  for (const l of upper) {
    const m = l.match(/^\s*\d+\s+(.+)$/);
    if (m?.[1]) {
      const v = fixCommonOcr(m[1].trim());
      if (
        v &&
        !v.includes("TICKET") &&
        !v.includes("PESAGEM") &&
        !v.includes("ASSINATURA") &&
        !v.includes("RECEBIMENTO") &&
        !v.includes("INSPE") &&
        !v.includes("MOTORISTA") &&
        !v.includes("VEIC") &&
        !looksLikeVehicle(v)
      ) {
        codedRaw.push(v);
      }
    }
  }

  const coded = codedRaw.filter((x) => {
    if (!veiculo) return true;
    const a = x.replace(/[^A-Z0-9]/g, "");
    const b = veiculo.replace(/[^A-Z0-9]/g, "");
    if (!a || !b) return true;
    return !(a === b || a.includes(b) || b.includes(a));
  });

  return { codedRaw, coded };
}

function extractPlainCandidates(upper: string[], veiculo: string | null) {
  const bannedHas = [
    "TICKET",
    "PESAGEM",
    "ASSINATURA",
    "RECEBIMENTO",
    "INSPE",
    "MOTORISTA",
    "VEC/CAVALO",
    "VEIC",
    "OBS",
    "P. GERAL",
    "P. OBRA",
    "UA-01", // geralmente cabeçalho do quadrinho
  ];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const l0 of upper) {
    const l = fixCommonOcr(l0);

    if (!l) continue;
    if (l.length < 3) continue;

    if (bannedHas.some((b) => l.includes(b))) continue;

    // ignora cabeçalho da empresa
    if (l.includes("CONSTRU") || l.includes("LTDA")) continue;

    // ignora datas/horas/pesos isolados
    if (/\b\d{2}\/\d{2}\/\d{2,4}\b/.test(l)) continue;
    if (TIME_RE.test(l)) continue;
    TIME_RE.lastIndex = 0;

    if (WEIGHT_RE.test(l) || WEIGHT_SPACE_RE.test(l)) {
      WEIGHT_RE.lastIndex = 0;
      WEIGHT_SPACE_RE.lastIndex = 0;
      // se a linha for só número, ignora
      if (/^\d{1,3}[.,/]\d{3}$/.test(l) || /^\d{1,3}\s\d{3}$/.test(l)) continue;
    }
    WEIGHT_RE.lastIndex = 0;
    WEIGHT_SPACE_RE.lastIndex = 0;

    // ignora o próprio veículo repetido
    if (veiculo) {
      const a = l.replace(/[^A-Z0-9]/g, "");
      const b = veiculo.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (a && b && (a === b || a.includes(b) || b.includes(a))) continue;
    }

    // ignora linhas que “parecem veículo”
    if (looksLikeVehicle(l)) continue;

    const key = l;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(l);
  }

  return out;
}

function isMaterialCandidate(s: string) {
  const x = (s || "").toUpperCase();
  const keys = [
    "MASSA",
    "CBUQ",
    "RR",
    "DILUI",
    "PO ",
    "PÓ",
    "BRITA",
    "AREIA",
    "FUNDO",
    "REJEITO",
    "ASFALTO",
    "CAP",
    "EMULS",
    "CIMENTO",
  ];
  return keys.some((k) => x.includes(k));
}

function pickTriplet(cands: string[]) {
  if (cands.length < 2) {
    return { origem: cands[0] || null, destino: null, material: null };
  }
  if (cands.length === 2) {
    // tenta achar material
    const mIdx = cands.findIndex(isMaterialCandidate);
    if (mIdx >= 0) {
      const material = cands[mIdx];
      const rest = cands.filter((_, i) => i !== mIdx);
      return { origem: rest[0] || null, destino: rest[1] || null, material };
    }
    return { origem: cands[0], destino: cands[1], material: null };
  }

  // 3+ candidatos
  const mIdx = cands.findIndex(isMaterialCandidate);
  if (mIdx >= 0) {
    const material = cands[mIdx];
    const rest = cands.filter((_, i) => i !== mIdx);
    return {
      origem: rest[0] || null,
      destino: rest[1] || null,
      material,
    };
  }

  // sem material “óbvio”: assume ordem natural
  return { origem: cands[0], destino: cands[1], material: cands[2] };
}

function parseTicketFields(rawFull: string) {
  const { lines, upper } = toUpperLines(rawFull);

  const veiculo = pickVehicleFromContext(rawFull, upper);

  // DATA (pega última válida; ignora tipo 16/91/2026)
  const dataBr = pickBestDate(rawFull);

  // HORÁRIO (primeiro válido)
  const timeMatches = rawFull.match(TIME_RE) || [];
  const horario = timeMatches[0] || null;

  // PESOS (inclui OCR com "/" e espaço)
  const tokens = [
    ...(rawFull.match(WEIGHT_RE) || []),
    ...(rawFull.match(WEIGHT_SPACE_RE) || []),
  ];

  const pesoNums = tokens
    .map(parseWeightToken)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n > 0);

  const peso_t = pickNetWeight(pesoNums);
  const peso_mask = peso_t !== null ? Number(peso_t).toFixed(3) : null;

  // ORIGEM / DESTINO / MATERIAL
  const { codedRaw, coded } = extractCodedTriplet(upper, veiculo);

  let origem: string | null = null;
  let destino: string | null = null;
  let material: string | null = null;

  if (coded.length >= 3) {
    // preferência 1: linhas numeradas (quando OCR pega a coluna do número)
    origem = coded[0];
    destino = coded[1];
    material = coded[2];
  } else {
    // fallback robusto: usar candidatos “livres” preservando a ordem natural do OCR
    const plain = extractPlainCandidates(upper, veiculo);

    // regra extra: se "GPA ENGENHARIA" aparecer isolado (sem CONSTRU), tende a ser origem
    const gpaIdx = plain.findIndex(
      (x) => x === "GPA ENGENHARIA" || x.includes("GPA ENGENHARIA")
    );
    if (gpaIdx > 0) {
      // move GPA pro início (origem)
      const gpa = plain[gpaIdx];
      plain.splice(gpaIdx, 1);
      plain.unshift(gpa);
    }

    const tri = pickTriplet(plain);
    origem = tri.origem;
    destino = tri.destino;
    material = tri.material;
  }

  const clean = (s: string | null) => (s ? fixCommonOcr(s).trim() : null);

  return {
    veiculo: clean(veiculo),
    origem: clean(origem),
    destino: clean(destino),
    material: clean(material),
    data_br: dataBr,
    horario: horario ? (horario.length === 5 ? `${horario}:00` : horario) : null,
    peso_t,
    peso_mask,
    debug: {
