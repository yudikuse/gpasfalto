import { NextResponse } from "next/server";
import { createSign } from "crypto";

export const runtime = "nodejs";

type Kind = "horimetro" | "abastecimento" | "odometro";

type Vertex = { x?: number; y?: number };
type VisionText = {
  description?: string;
  boundingPoly?: { vertices?: Vertex[] };
};

let tokenCache: { accessToken: string; expMs: number } | null = null;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function b64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf8");
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function safeParseJSON<T = any>(s: string): T | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function decodeServiceAccountFromEnv() {
  const b64 =
    process.env.GCP_SA_KEY_BASE64 ||
    process.env.GCP_KEY_BASE64 || // compat
    "";

  if (!b64) return null;

  const raw = Buffer.from(b64, "base64").toString("utf8").trim();
  const sa = safeParseJSON<any>(raw);
  if (!sa?.client_email || !sa?.private_key) return null;
  return sa as { client_email: string; private_key: string };
}

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && tokenCache.expMs - now > 60_000) return tokenCache.accessToken;

  const sa = decodeServiceAccountFromEnv();
  if (!sa) throw new Error("Env GCP_SA_KEY_BASE64 (ou GCP_KEY_BASE64) inválida/não configurada.");

  const iat = Math.floor(now / 1000);
  const exp = iat + 55 * 60;

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp,
    })
  );

  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(sa.private_key);
  const jwt = `${unsigned}.${b64url(signature)}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwt);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.access_token) {
    throw new Error(`Falha ao obter access_token: ${JSON.stringify(data)}`);
  }

  tokenCache = { accessToken: data.access_token, expMs: exp * 1000 };
  return data.access_token as string;
}

async function fetchImageAsBase64(url: string) {
  if (url.startsWith("data:")) {
    const comma = url.indexOf(",");
    if (comma === -1) throw new Error("dataURL inválida");
    return url.slice(comma + 1);
  }

  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`Falha ao baixar imagem: HTTP ${r.status}`);
  const ab = await r.arrayBuffer();
  return Buffer.from(ab).toString("base64");
}

function bboxOf(vertices?: Vertex[]) {
  const v = vertices || [];
  const xs = v.map((p) => p.x ?? 0);
  const ys = v.map((p) => p.y ?? 0);
  const x1 = Math.min(...xs, 0);
  const x2 = Math.max(...xs, 0);
  const y1 = Math.min(...ys, 0);
  const y2 = Math.max(...ys, 0);
  const w = Math.max(1, x2 - x1);
  const h = Math.max(1, y2 - y1);
  return { x1, x2, y1, y2, w, h, area: w * h, cx: (x1 + x2) / 2, cy: (y1 + y2) / 2 };
}

type Tok = {
  raw: string;
  digits: string; // só números
  hasSep: boolean;
  box: ReturnType<typeof bboxOf>;
};

function isLikelyScaleNumber(n: number) {
  // números típicos de escala/mostrador que atrapalham (RPM/temperatura/etc)
  const bad = new Set([
    0, 1, 2, 3, 4, 5,
    10, 11, 15, 20, 25, 30, 35, 40,
    50, 60, 70, 80, 90, 100, 110, 120,
    150, 200,
  ]);
  return bad.has(Math.round(n));
}

function formatPtBr(main: number, decDigit: string | null) {
  const d = decDigit && /^\d$/.test(decDigit) ? decDigit : "0";
  return `${main},${d}`;
}

function parseCandidateFromDigits(kind: Kind, digits: string, attachDec: boolean) {
  if (!digits) return null;

  // remove lixo (só por segurança)
  const pure = digits.replace(/[^\d]/g, "");
  if (!pure) return null;

  // regras por tipo
  if (kind === "abastecimento") {
    if (pure.length < 2) return null;
    const main = Number(pure.slice(0, -1)); // preserva "0310" -> main=31
    const dec = pure.slice(-1);
    const value = main + Number(dec) / 10;
    return { value, main, dec, input: formatPtBr(main, dec) };
  }

  if (kind === "horimetro") {
    if (pure.length < 3) return null;

    if (attachDec && pure.length >= 2) {
      const main = Number(pure.slice(0, -1));
      const dec = pure.slice(-1);
      const value = main + Number(dec) / 10;
      return { value, main, dec, input: formatPtBr(main, dec) };
    }

    const main = Number(pure);
    const value = main;
    return { value, main, dec: "0", input: formatPtBr(main, "0") };
  }

  // odometro (se usar depois): inteiro
  const main = Number(pure);
  return { value: main, main, dec: null, input: String(main) };
}

function pickDecimalNear(mainTok: Tok, all: Tok[]) {
  // procura 1 dígito pequeno perto do canto direito/baixo do bloco principal (decimal mecânico)
  const candidates = all
    .filter((t) => t.digits.length === 1)
    .filter((t) => t.box.area < mainTok.box.area * 0.35)
    .filter((t) => {
      const nearX = t.box.cx >= mainTok.box.x2 - mainTok.box.w * 0.1 && t.box.cx <= mainTok.box.x2 + mainTok.box.w * 0.7;
      const nearY = t.box.cy >= mainTok.box.y1 - mainTok.box.h * 0.2 && t.box.cy <= mainTok.box.y2 + mainTok.box.h * 0.8;
      return nearX && nearY;
    })
    .sort((a, b) => b.box.area - a.box.area);

  return candidates[0]?.digits ?? null;
}

function score(kind: Kind, value: number, tok: Tok, refHorimetro: number | null) {
  let s = Math.log(tok.box.area + 1) + tok.digits.length * 0.6;

  if (isLikelyScaleNumber(value)) s -= 10;

  if (kind === "abastecimento") {
    // diesel normalmente 1..800 L
    if (value < 1 || value > 800) s -= 50;
    if (tok.digits.length >= 3 && tok.digits.length <= 5) s += 2;
  }

  if (kind === "horimetro") {
    if (value < 0 || value > 300000) s -= 50;
    if (refHorimetro != null) {
      const diff = Math.abs(value - refHorimetro);
      s -= diff / 40; // puxa pro mais próximo do histórico
      if (value + 0.05 < refHorimetro) s -= 3; // evita “voltar”
    }
    if (tok.digits.length >= 4) s += 1.5;
  }

  return s;
}

async function getRefHorimetro(equip: string | null) {
  if (!equip) return null;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) return null;

  try {
    // import dinâmico evita treta em build/edge
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(url, key, { auth: { persistSession: false } });

    // tentativa 1 (mais provável)
    let q = sb
      .from("equipament_hours")
      .select("horimetro,data,equipamento,equip")
      .limit(1);

    // tenta encaixar coluna/valor
    q = q.or(`equipamento.eq.${equip},equip.eq.${equip}`);

    const { data, error } = await q.order("data", { ascending: false });

    if (error || !data?.[0]) return null;

    const v = Number((data[0] as any).horimetro);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const kind = (searchParams.get("kind") || "horimetro") as Kind;
  const url = searchParams.get("url") || "";
  const equip = searchParams.get("equip");

  if (!url) return jsonError("Parâmetro 'url' é obrigatório.", 400);

  let refHorimetro: number | null = null;
  if (kind === "horimetro") {
    refHorimetro = await getRefHorimetro(equip);
  }

  try {
    const accessToken = await getAccessToken();
    const imageB64 = await fetchImageAsBase64(url);

    const body = {
      requests: [
        {
          image: { content: imageB64 },
          features: [{ type: "TEXT_DETECTION" }],
          imageContext: {
            languageHints: ["pt", "en"],
          },
        },
      ],
    };

    const vr = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const vjson = await vr.json();
    if (!vr.ok) {
      return NextResponse.json(
        { ok: false, error: "Vision API error", details: vjson },
        { status: 500 }
      );
    }

    const r0 = vjson?.responses?.[0] || {};
    const fullText: string =
      r0?.fullTextAnnotation?.text ||
      r0?.textAnnotations?.[0]?.description ||
      "";

    const words: VisionText[] = Array.isArray(r0?.textAnnotations)
      ? (r0.textAnnotations as VisionText[]).slice(1)
      : [];

    const toks: Tok[] = words
      .map((w) => {
        const raw = String(w?.description || "").trim();
        const digits = raw.replace(/[^\d]/g, "");
        const hasSep = /[.,]/.test(raw);
        const box = bboxOf(w?.boundingPoly?.vertices);
        return { raw, digits, hasSep, box };
      })
      .filter((t) => t.digits.length > 0);

    // GUARD: se pediram abastecimento mas a imagem parece horímetro/mostrador (evita sugestão errada)
    if (
      kind === "abastecimento" &&
      /(QUARTZO|RPM|TUR|RPM\s*x\s*100)/i.test(fullText)
    ) {
      return NextResponse.json({
        ok: true,
        kind,
        best: null,
        best_input: null,
        candidates: [],
        candidates_input: [],
        raw: fullText,
        ref_horimetro: refHorimetro,
        debug: { token_count: toks.length, guarded: true },
      });
    }

    // candidatos: pega tokens “grandes” e/ou com muitos dígitos
    const pre = toks
      .filter((t) => t.digits.length >= 2) // ignora 1 dígito solto (escala)
      .sort((a, b) => b.box.area - a.box.area)
      .slice(0, 25);

    const candidates: { value: number; input: string; tok: Tok }[] = [];

    for (const t of pre) {
      // decimal “anexado” quando tem 1 dígito pequeno perto
      const nearDec = pickDecimalNear(t, toks);

      // horímetro: só anexa decimal se realmente achar um dígito próximo
      const attachDec = kind === "abastecimento" ? true : nearDec != null;

      // se achou decimal perto, “cola” no final (ex: 03647 + 2 => 036472)
      const digitsWithDec =
        attachDec && nearDec ? `${t.digits}${nearDec}` : t.digits;

      const parsed = parseCandidateFromDigits(kind, digitsWithDec, attachDec);
      if (!parsed) continue;

      candidates.push({ value: parsed.value, input: parsed.input, tok: t });
    }

    // fallback: se nada entrou, tenta pelo fullText (último recurso)
    if (candidates.length === 0 && fullText) {
      const allNums = fullText.match(/\d+/g) || [];
      for (const d of allNums) {
        const parsed = parseCandidateFromDigits(kind, d, false);
        if (parsed) candidates.push({ value: parsed.value, input: parsed.input, tok: { raw: d, digits: d, hasSep: false, box: { x1: 0, x2: 1, y1: 0, y2: 1, w: 1, h: 1, area: 1, cx: 0, cy: 0 } } });
      }
    }

    // escolhe melhor pelo score
    let best = candidates
      .map((c) => ({
        ...c,
        s: score(kind, c.value, c.tok, refHorimetro),
      }))
      .sort((a, b) => b.s - a.s)[0];

    const bestValue = best ? best.value : null;
    const bestInput = best ? best.input : null;

    return NextResponse.json({
      ok: true,
      kind,
      best: bestValue != null ? String(bestValue) : null,
      best_input: bestInput,
      candidates: candidates.slice(0, 10).map((c) => c.value),
      candidates_input: candidates.slice(0, 10).map((c) => c.input),
      raw: fullText,
      ref_horimetro: refHorimetro,
      debug: {
        token_count: toks.length,
        used_top_boxes: pre.length,
      },
    });
  } catch (e: any) {
    return jsonError(`OCR: ${e?.message || String(e)}`, 500);
  }
}
