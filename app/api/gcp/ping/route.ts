import { NextResponse } from "next/server";
import { GoogleAuth } from "google-auth-library";

export const runtime = "nodejs";

function readCredentialsFromEnv() {
  const b64 = process.env.GCP_SA_KEY_BASE64 || "";
  if (!b64) throw new Error("GCP_SA_KEY_BASE64 não configurada no ambiente.");

  const jsonStr = Buffer.from(b64, "base64").toString("utf-8");
  const creds = JSON.parse(jsonStr);

  if (!creds.client_email || !creds.private_key) {
    throw new Error("Credencial inválida: faltou client_email/private_key.");
  }

  return creds;
}

export async function GET() {
  try {
    const creds = readCredentialsFromEnv();

    const auth = new GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    const client = await auth.getClient();
    const tokenResp = await client.getAccessToken();
    const token = typeof tokenResp === "string" ? tokenResp : tokenResp?.token;

    if (!token) throw new Error("Não foi possível obter access token.");

    return NextResponse.json({
      ok: true,
      project_id: creds.project_id || null,
      client_email: creds.client_email,
      token_ok: true,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Falha no ping do GCP" },
      { status: 500 }
    );
  }
}
