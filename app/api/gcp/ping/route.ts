// FILE: app/api/gcp/ping/route.ts
import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

function resolveServiceAccountFromEnv() {
  // Alinhado com o OCR + compatibilidade antiga
  const b64 =
    process.env.GCP_KEY_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_B64 ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS_BASE64 ||
    process.env.GCP_SA_KEY_BASE64 ||
    "";

  if (!b64) {
    throw new Error(
      "Nenhuma credencial configurada. Defina uma destas envs: " +
        "GCP_KEY_BASE64 | GOOGLE_SERVICE_ACCOUNT_B64 | GOOGLE_APPLICATION_CREDENTIALS_BASE64 | GCP_SA_KEY_BASE64",
    );
  }

  let creds: any;
  try {
    const jsonStr = Buffer.from(b64, "base64").toString("utf-8");
    creds = JSON.parse(jsonStr);
  } catch {
    throw new Error(
      "Falha ao decodificar o base64/JSON do service account. Verifique se o conteúdo é o JSON do service account em base64.",
    );
  }

  if (!creds?.client_email || !creds?.private_key) {
    throw new Error(
      "Credencial inválida: faltou client_email/private_key no JSON do service account.",
    );
  }

  return creds;
}

export async function GET() {
  try {
    const creds = resolveServiceAccountFromEnv();

    const auth = new GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const token = await auth.getAccessToken();
    if (!token) throw new Error("Não foi possível obter access token.");

    // Não exponha o token inteiro em produção
    const tokenPrefix = token.slice(0, 8);

    return NextResponse.json({
      ok: true,
      mode: "service_account",
      project_id: creds.project_id || null,
      client_email: creds.client_email,
      token_ok: true,
      token_prefix: tokenPrefix,
      token_len: token.length,
      note: "Ping OK. Se o OCR falhar, o problema provavelmente é imagem/recorte/heurística, não credencial.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Falha no ping do GCP" },
      { status: 500 },
    );
  }
}
