// FILE: app/t/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function getBaseUrl() {
  const h = headers();
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  if (!host) return "https://gpasfalto.vercel.app";
  return `${proto}://${host}`;
}

function formatDateBR(dateLike: any): string {
  if (!dateLike) return "";
  const s = String(dateLike).trim();

  // já está em dd/mm/aa
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(s)) {
    const [dd, mm, yy] = s.split("/");
    const y2 = yy.length === 2 ? yy : yy.slice(-2);
    return `${dd}/${mm}/${y2}`;
  }

  // yyyy-mm-dd
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const yy = m[1].slice(-2);
    return `${m[3]}/${m[2]}/${yy}`;
  }

  return s;
}

function formatPeso3(v: any): string {
  const n = typeof v === "number" ? v : Number.parseFloat(String(v).replace(",", "."));
  if (!Number.isFinite(n)) return "";
  return Number(n).toFixed(3);
}

export default async function TicketSharePage({
  params,
}: {
  params: { id: string };
}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    "";

  if (!supabaseUrl || !supabaseKey) {
    return (
      <main style={{ padding: 16, fontFamily: "system-ui, Arial" }}>
        <h1 style={{ fontSize: 18, marginBottom: 8 }}>Ticket</h1>
        <p style={{ color: "#b00020" }}>
          Faltam variáveis <b>NEXT_PUBLIC_SUPABASE_URL</b> e/ou{" "}
          <b>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY</b> no Vercel.
        </p>
      </main>
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) notFound();

  const { data: row, error } = await supabase
    .from("material_tickets")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !row) notFound();

  const baseUrl = getBaseUrl();
  const shortLink = `${baseUrl}/t/${row.id}`;

  // tenta gerar URL assinada da foto (bucket privado)
  let signedUrl: string | null = null;
  const path = (row.arquivo_path || "").toString().trim();
  if (path) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("tickets")
      .createSignedUrl(path, 60 * 60 * 24 * 7); // 7 dias

    if (!signErr && signed?.signedUrl) signedUrl = signed.signedUrl;
  }

  const tipo = (row.tipo || "").toString().trim().toUpperCase() || "TICKET";
  const veiculo = (row.veiculo || "").toString().trim();
  const origem = (row.origem || "").toString().trim();
  const destino = (row.destino || "").toString().trim();
  const material = (row.material || "").toString().trim();
  const dataBr = formatDateBR(row.data);
  const horario = (row.horario || "").toString().trim();
  const peso = formatPeso3(row.peso_t ?? row.peso ?? row.peso_mask);

  const msg =
    `${tipo} (link curto)\n` +
    `ID: ${row.id}\n` +
    (veiculo ? `Veículo: ${veiculo}\n` : "") +
    (dataBr || horario ? `Data/Hora: ${dataBr} ${horario}`.trim() + `\n` : "") +
    (origem ? `Origem: ${origem}\n` : "") +
    (destino ? `Destino: ${destino}\n` : "") +
    (material ? `Material: ${material}\n` : "") +
    (peso ? `Peso (t): ${peso}\n` : "") +
    `\n${shortLink}`;

  const waUrl = `https://wa.me/?text=${encodeURIComponent(msg)}`;

  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: 16, fontFamily: "system-ui, Arial" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>{tipo}</h1>
        <div style={{ color: "#666" }}>ID: {row.id}</div>
      </div>

      <div style={{ marginTop: 12, padding: 12, border: "1px solid #e5e5e5", borderRadius: 12 }}>
        <div><b>Veículo:</b> {veiculo || "-"}</div>
        <div><b>Data/Hora:</b> {(dataBr || "-") + (horario ? ` ${horario}` : "")}</div>
        <div><b>Origem:</b> {origem || "-"}</div>
        <div><b>Destino:</b> {destino || "-"}</div>
        <div><b>Material:</b> {material || "-"}</div>
        <div><b>Peso (t):</b> {peso || "-"}</div>
      </div>

      {signedUrl ? (
        <div style={{ marginTop: 14 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signedUrl}
            alt="Foto do ticket"
            style={{ width: "100%", borderRadius: 12, border: "1px solid #eee" }}
          />
          <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <a href={signedUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              Abrir foto
            </a>
            <a href={waUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              Compartilhar no WhatsApp
            </a>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 14, color: "#666" }}>
          Foto não disponível (sem arquivo_path ou sem permissão para assinar URL).
          <div style={{ marginTop: 8 }}>
            <a href={waUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>
              Compartilhar no WhatsApp
            </a>
          </div>
        </div>
      )}

      <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "#f7f7f7", whiteSpace: "pre-wrap" }}>
        {msg}
      </div>
    </main>
  );
}
