// FILE: app/api/financeiro/buscar-credor/route.ts
// Proxy server-side para evitar CORS ao chamar a API do Sienge
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIENGE_TENANT = process.env.NEXT_PUBLIC_SIENGE_TENANT ?? "";
const SIENGE_USER   = process.env.NEXT_PUBLIC_SIENGE_USER   ?? "";
const SIENGE_PASS   = process.env.NEXT_PUBLIC_SIENGE_PASS   ?? "";
const SIENGE_BASE   = `https://api.sienge.com.br/${SIENGE_TENANT}/public/api/v1`;

export async function GET(req: NextRequest) {
  const cnpj = req.nextUrl.searchParams.get("cnpj")?.replace(/\D/g, "");
  if (!cnpj) return NextResponse.json({ ok: false, error: "CNPJ obrigatório" }, { status: 400 });

  try {
    const auth = btoa(`${SIENGE_USER}:${SIENGE_PASS}`);
    const r = await fetch(`${SIENGE_BASE}/creditors?cpfCnpj=${cnpj}&limit=5`, {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    });
    if (!r.ok) return NextResponse.json({ ok: false, error: `Sienge HTTP ${r.status}` }, { status: r.status });
    const d = await r.json();
    const list: any[] = d.results ?? d.data ?? (Array.isArray(d) ? d : []);
    if (!list.length) return NextResponse.json({ ok: true, found: false });
    return NextResponse.json({ ok: true, found: true, id: list[0].id, nome: list[0].name ?? list[0].companyName ?? "" });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  // Criar credor novo no Sienge
  try {
    const body = await req.json();
    const auth = btoa(`${SIENGE_USER}:${SIENGE_PASS}`);
    const r = await fetch(`${SIENGE_BASE}/creditors`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
    });
    const txt = await r.text();
    let data: any = {};
    try { data = JSON.parse(txt); } catch {}
    if (r.ok || r.status === 201) return NextResponse.json({ ok: true, id: data.id ?? data.creditorId, ...data });
    return NextResponse.json({ ok: false, error: txt }, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}
