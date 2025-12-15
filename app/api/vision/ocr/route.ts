import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function jsonError(message: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error: message, ...extra }, { status });
}

function base64url(input: Buffer | string) {
  const b = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return b
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function getServiceAccountFromEnv(): any {
  const b64 = process.env.GCP_KEY_BASE64;
  if (!b64) throw new Error("Env GCP_KEY_BASE64 não configurada.");
  const json = Buffer.from(b64, "base64").toString("utf8");
  return JSON.parse(json);
}

let tokenCache: { token: string; exp: number } | null = null;

async function getAccessToken(scopes: string[]) {
  const now = Math.floor(Date.now() / 1000);

  if (tokenCache && tokenCache.exp > now + 60) {
    return tokenCache.token;
  }

  const sa = getServiceAccountFromEnv();

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: scopes.join(" "),
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const toSign = `${header}.${payload}`;
  const signature = crypto.createSign("RSA-SHA256").update(toSign).sign(sa.private_key);
  const assertion = `${toSign}.${base64url(signature)}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  const data: any = await resp.json();
  if (!resp.ok || !data?.access_token) {
    throw new Error(`Falha ao obter token OAuth: ${data?.error || resp.statusText}`);
  }

  tokenCache = { token: data.access_token, exp: now + Math.min(3500, data.expires_in || 3600) };
  return data.access_token as string;
}

function parsePtBrDecimal(s: string): number | null {
  const v = (s || "").trim();
  if (!v) return null;

  // mantém dígitos + , .
  const cleaned = v.replace(/[^\d,.-]/g, "");
  if (!cleaned) return null;

  // pt-BR: remove milhares ".", troca "," por "."
  const normalized = cleaned.replace(/\./g, "").replace(",", ".");
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function fmt1(n: number) {
  // 1 casa decimal com vírgula
  return n.toFixed(1).replace(".", ",");
}

type Kind = "horimetro" | "abastecimento" | "odometro" | "generic";

function scoreCandidate(kind: Kind, n: number, expected: number | null) {
  let score = 0;

  // tamanho (quantidade de dígitos aproximada)
  const digits = String(Math.abs(Math.round(n * 10))).length;
  score += Math.min(10, digits);

  if (kind === "abastecimento") {
    // litros: normalmente 10–600, mas aceita até 2000
    if (n <= 0 || n > 2000) score -= 100;
    if (n >= 10 && n <= 600) score += 8;
    if (n >= 1 && n < 10) score -= 6;
  }

  if (kind === "horimetro") {
    // horímetro: normalmente 100–60000 (aceita até 100000)
    if (n < 0 || n > 200000) score -= 100;
    if (n > 100000) score -= 20;
    if (n >= 100 && n <= 60000) score += 8;
    if (n < 50) score -= 8; // evita “100” de RPM virar 10,0 etc
  }

  // ancoragem no esperado (equipament_hours)
  if (expected != null && Number.isFinite(expected)) {
    const diff = Math.abs(n - expected);

    // favorece bem perto
    const bonus = Math.max(0, 16 - Math.log10(diff + 1) * 8);
    score += bonus;

    // penaliza “voltar”
    if (n < expected - 1) score -= 10;
  }

  return score;
}

function unique1Dec(list: number[]) {
  const seen = new Set<string>();
  const out: number[] = [];
  for (const n of list) {
    const key = (Math.round(n * 10) / 10).toFixed(1);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Math.round(n * 10) / 10);
  }
  return out;
}

function extractCandidatesFromRaw(raw: string, kind: Kind) {
  const candidates: number[] = [];

  // 1) padrões com separador (11145,2 / 11145.2)
  const reSep = /\d[\d.]*[.,]\d+/g;
  const sepMatches = raw.match(reSep) || [];
  for (const m of sepMatches) {
    const n = parsePtBrDecimal(m);
    if (n != null) candidates.push(n);
  }

  // 2) só dígitos (ex.: 1146 -> 114,6 ; 111452 -> 11145,2)
  const reDigits = /\d{2,10}/g;
  const digMatches = raw.match(reDigits) || [];
  for (const d of digMatches) {
    const i = Number.parseInt(d, 10);
    if (Number.isFinite(i)) {
      candidates.push(i); // inteiro puro (às vezes útil)
      candidates.push(i / 10); // regra 1 casa decimal (o seu caso)
    }
  }

  // filtros suaves por kind (sem “matar” candidato cedo demais)
  const filtered = candidates.filter((n) => Number.isFinite(n));

  return unique1Dec(filtered);
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const kind = (searchParams.get("kind") || "generic") as Kind;
    const url = searchParams.get("url");
    const expectedStr = searchParams.get("expected");
    const expected = expectedStr ? Number.parseFloat(expectedStr.replace(",", ".")) : null;

    if (!url) return jsonError("Informe a query ?url=...");
    if (!/^https?:\/\//i.test(url)) return jsonError("URL inválida.");

    // baixa a imagem (signed url do supabase funciona)
    const imgResp = await fetch(url);
    if (!imgResp.ok) return jsonError("Falha ao baixar imagem.", 400, { status: imgResp.status });

    const buf = Buffer.from(await imgResp.arrayBuffer());
    const contentB64 = buf.toString("base64");

    const token = await getAccessToken(["https://www.googleapis.com/auth/cloud-platform"]);

    const visionResp = await fetch("https://vision.googleapis.com/v1/images:annotate", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            image: { content: contentB64 },
            features: [{ type: "TEXT_DETECTION" }],
            imageContext: { languageHints: ["pt", "en"] },
          },
        ],
      }),
    });

    const visionJson: any = await visionResp.json();
    if (!visionResp.ok) {
      return jsonError("Erro no Vision API.", 500, { details: visionJson });
    }

    const ann = visionJson?.responses?.[0];
    const raw =
      (ann?.fullTextAnnotation?.text ||
        ann?.textAnnotations?.[0]?.description ||
        "")?.toString()?.trim() || "";

    const candidates = extractCandidatesFromRaw(raw, kind);

    const scored = candidates
      .map((n) => ({ n, s: scoreCandidate(kind, n, expected) }))
      .sort((a, b) => b.s - a.s);

    const best = scored.length ? scored[0].n : null;

    return NextResponse.json({
      ok: true,
      kind,
      expected: expected ?? null,
      best,
      best_input: best != null ? fmt1(best) : null,
      candidates: scored.slice(0, 12).map((x) => x.n),
      candidates_input: scored.slice(0, 12).map((x) => fmt1(x.n)),
      raw,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Falha no OCR.", 500);
  }
}
