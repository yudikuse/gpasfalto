import { NextResponse } from "next/server";
import crypto from "crypto";

export const runtime = "nodejs";

type Kind = "equipamento" | "odometro" | "horimetro" | "abastecimento";

function json(status: number, body: any) {
  return NextResponse.json(body, { status });
}

function b64url(input: Buffer | string) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function mustEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function loadServiceAccount() {
  const b64 = mustEnv("GCP_SA_KEY_BASE64");
  const raw = Buffer.from(b64, "base64").toString("utf8");
  const sa = JSON.parse(raw);

  if (!sa.client_email || !sa.private_key) {
    throw new Error("Service Account JSON inválido (sem client_email/private_key).");
  }

  return {
    clientEmail: sa.client_email as string,
    privateKey: sa.private_key as string,
    projectId: (process.env.GCP_PROJECT_ID as string) || (sa.project_id as string) || "",
  };
}

let tokenCache: { token: string; expMs: number } | null = null;

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache && now < tokenCache.expMs - 30_000) return tokenCache.token;

  const { clientEmail, privateKey } = loadServiceAccount();

  const iat = Math.floor(now / 1000);
  const exp = iat + 3600;

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp,
  };

  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(
    JSON.stringify(payload)
  )}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();

  const signature = signer.sign(privateKey);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const form = new URLSearchParams();
  form.set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  form.set("assertion", jwt);

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Token error: ${resp.status} ${JSON.stringify(data)}`);

  const accessToken = data.access_token as string;
  const expiresIn = (data.expires_in as number) || 3600;

  tokenCache = { token: accessToken, expMs: now + expiresIn * 1000 };
  return accessToken;
}

function normalizeText(t: string) {
  return (t || "")
    .replace(/\u00A0/g, " ")
    .replace(/[|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractCandidates(text: string) {
  const t = text.toUpperCase();

  const nums = Array.from(t.matchAll(/\d+(?:[.,]\d+)?/g)).map((m) => m[0]);

  const eq = Array.from(t.matchAll(/\b[A-Z]{1,3}\s?-?\s?\d{2}\b/g)).map((m) =>
    m[0].replace(/\s+/g, "").replace("-", "")
  );

  return { nums, eq };
}

function toNumberSmart(s: string) {
  const a = s.replace(/\./g, "").replace(",", ".");
  const n = Number(a);
  if (Number.isFinite(n)) return n;

  const b = s.replace(",", ".");
  const n2 = Number(b);
  if (Number.isFinite(n2)) return n2;

  return null;
}

function formatInputNoGroup(n: number, decimals: number) {
  // sem separador de milhar, com vírgula decimal (pra preencher input)
  const fixed = n.toFixed(decimals); // "11145.2"
  return fixed.replace(".", ","); // "11145,2"
}

function adjustKindDecimal(kind: Kind, n: number) {
  // HORÍMETRO: normalmente 0,1 (uma casa). Quando OCR “junta”, vira inteiro grande (ex 111452).
  if (kind === "horimetro") {
    if (Number.isInteger(n) && n >= 100000 && n <= 2000000) {
      return n / 10;
    }
    return n;
  }

  // ABASTECIMENTO (litros): normalmente 0,1. Se veio 1231, provavelmente é 123,1.
  if (kind === "abastecimento") {
    if (Number.isInteger(n) && n >= 1000 && n <= 200000) {
      return n / 10;
    }
    return n;
  }

  return n;
}

function pickBest(kind: Kind, rawText: string) {
  const text = normalizeText(rawText);
  const { nums, eq } = extractCandidates(text);

  if (kind === "equipamento") {
    const best = eq[0] || null;
    return { best, best_input: best, candidates: eq.slice(0, 10), candidates_input: eq.slice(0, 10), raw: text };
  }

  const values = nums
    .map((s) => ({ s, n: toNumberSmart(s) }))
    .filter((x) => x.n !== null) as Array<{ s: string; n: number }>;

  if (kind === "odometro") {
    const filtered = values
      .filter((v) => Number.isInteger(v.n) && v.n >= 1000 && v.n <= 50_000_000)
      .sort((a, b) => b.n - a.n);

    const best = filtered[0]?.n ?? null;
    return {
      best,
      best_input: best !== null ? String(best) : null,
      candidates: filtered.slice(0, 10).map((x) => x.n),
      candidates_input: filtered.slice(0, 10).map((x) => String(x.n)),
      raw: text,
    };
  }

  if (kind === "horimetro") {
    const filtered = values
      .map((v) => ({ ...v, n: adjustKindDecimal(kind, v.n) }))
      .filter((v) => v.n >= 0 && v.n <= 2_000_000)
      .sort((a, b) => b.n - a.n);

    const best = filtered[0]?.n ?? null;
    return {
      best,
      best_input: best !== null ? formatInputNoGroup(best, 1) : null,
      candidates: filtered.slice(0, 10).map((x) => x.n),
      candidates_input: filtered.slice(0, 10).map((x) => formatInputNoGroup(x.n, 1)),
      raw: text,
    };
  }

  // abastecimento
  const filtered = values
    .map((v) => ({ ...v, n: adjustKindDecimal(kind, v.n) }))
    .filter((v) => v.n > 0 && v.n <= 2000)
    .sort((a, b) => b.n - a.n);

  const best = filtered[0]?.n ?? null;
  return {
    best,
    best_input: best !== null ? formatInputNoGroup(best, 1) : null,
    candidates: filtered.slice(0, 10).map((x) => x.n),
    candidates_input: filtered.slice(0, 10).map((x) => formatInputNoGroup(x.n, 1)),
    raw: text,
  };
}

async function runVisionOCR(imageUrl: string) {
  const token = await getAccessToken();

  const body = {
    requests: [
      {
        image: { source: { imageUri: imageUrl } },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
      },
    ],
  };

  const resp = await fetch("https://vision.googleapis.com/v1/images:annotate", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json();
  if (!resp.ok) throw new Error(`Vision error: ${resp.status} ${JSON.stringify(data)}`);

  const r0 = data?.responses?.[0];
  const text =
    r0?.fullTextAnnotation?.text ||
    r0?.textAnnotations?.[0]?.description ||
    "";

  return { text };
}

function validateUrl(u: string) {
  if (!u || typeof u !== "string") return null;
  if (!u.startsWith("https://")) return null;
  if (u.length > 4000) return null;
  return u;
}

export async function POST(req: Request) {
  try {
    const { kind, imageUrl } = (await req.json()) as { kind: Kind; imageUrl: string };

    if (!kind) return json(400, { ok: false, error: "missing kind" });

    const url = validateUrl(imageUrl);
    if (!url) return json(400, { ok: false, error: "imageUrl inválida (use https)" });

    const { text } = await runVisionOCR(url);
    const picked = pickBest(kind, text);

    return json(200, { ok: true, kind, ...picked });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}

export async function GET(req: Request) {
  try {
    const u = new URL(req.url);
    const kind = (u.searchParams.get("kind") || "") as Kind;
    const imageUrl = u.searchParams.get("url") || "";

    if (!kind || !imageUrl) {
      return json(200, { ok: true, hint: "Use ?kind=horimetro&url=https://..." });
    }

    const url = validateUrl(imageUrl);
    if (!url) return json(400, { ok: false, error: "url inválida (use https)" });

    const { text } = await runVisionOCR(url);
    const picked = pickBest(kind, text);

    return json(200, { ok: true, kind, ...picked });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
}
