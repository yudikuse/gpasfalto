// FILE: app/api/financeiro/criar-titulo/route.ts
// Proxy server-side para criar título no Sienge sem CORS
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIENGE_TENANT = process.env.NEXT_PUBLIC_SIENGE_TENANT ?? "";
const SIENGE_USER   = process.env.NEXT_PUBLIC_SIENGE_USER   ?? "";
const SIENGE_PASS   = process.env.NEXT_PUBLIC_SIENGE_PASS   ?? "";
const SIENGE_BASE   = `https://api.sienge.com.br/${SIENGE_TENANT}/public/api/v1`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const auth = btoa(`${SIENGE_USER}:${SIENGE_PASS}`);
    const r = await fetch(`${SIENGE_BASE}/bills`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let data: any = {};
    try { data = JSON.parse(txt); } catch {}

    if (r.ok || r.status === 201) {
      return NextResponse.json({ ok: true, ...data });
    }
    return NextResponse.json({ ok: false, error: txt, status: r.status }, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
