// FILE: app/t/[id]/page.tsx
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TicketRow = {
  id: number;
  tipo: string | null;
  veiculo: string | null;
  data: string | null; // YYYY-MM-DD (date)
  horario: string | null; // HH:MM:SS (time)
  origem: string | null;
  destino: string | null;
  material: string | null;
  peso_t: number | null;
  arquivo_path: string | null;
};

async function getBaseUrl() {
  const h = await headers(); // ✅ Next 16: headers() é async
  const proto = h.get("x-forwarded-proto") || "https";
  const host = h.get("x-forwarded-host") || h.get("host") || "";
  return host ? `${proto}://${host}` : "https://gpasfalto.vercel.app";
}

function getSupabase() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  if (!url || !anon) return null;

  return createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function fmtDateBR(iso: string | null) {
  if (!iso) return "";
  // iso "2026-01-16"
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso;
  return `${m[3]}/${m[2]}/${m[1].slice(-2)}`;
}

function fmtPeso(p: number | null) {
  if (p === null || !Number.isFinite(p)) return "";
  return Number(p).toFixed(3);
}

export default async function TicketSharePage({
  params,
}: {
  params: { id: string };
}) {
  const id = Number(params.id);
  if (!Number.isFinite(id)) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>ID inválido.</div>
    );
  }

  const supabase = getSupabase();
  if (!supabase) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <div style={{ fontWeight: 700 }}>Ticket</div>
        <div>Compartilhamento (link curto)</div>
        <div style={{ marginTop: 8 }}>
          Faltam variáveis NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
          (ou SUPABASE_URL / SUPABASE_ANON_KEY).
        </div>
      </div>
    );
  }

  const { data: ticket, error } = await supabase
    .from("material_tickets")
    .select(
      "id,tipo,veiculo,data,horario,origem,destino,material,peso_t,arquivo_path"
    )
    .eq("id", id)
    .maybeSingle<TicketRow>();

  if (error) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        Erro lendo ticket: {error.message}
      </div>
    );
  }

  if (!ticket) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        Ticket não encontrado.
      </div>
    );
  }

  // ✅ Link curto (pra WhatsApp) — você vai usar isso no "compartilhar"
  const baseUrl = await getBaseUrl();
  const linkCurto = `${baseUrl}/t/${ticket.id}`;

  // (Opcional) tentar assinar a URL pra abrir a foto dentro da página
  let signedUrl: string | null = null;
  if (ticket.arquivo_path) {
    const { data } = await supabase.storage
      .from("tickets")
      .createSignedUrl(ticket.arquivo_path, 60 * 60 * 24); // 24h
    signedUrl = data?.signedUrl ?? null;
  }

  const texto = [
    `✅ Ticket de ${ticket.tipo || "-"}`,
    `ID: ${ticket.id}`,
    `Veículo: ${ticket.veiculo || "-"}`,
    `Data/Hora: ${fmtDateBR(ticket.data)} ${ticket.horario || ""}`.trim(),
    `Origem: ${ticket.origem || "-"}`,
    `Destino: ${ticket.destino || "-"}`,
    `Material: ${ticket.material || "-"}`,
    `Peso (t): ${fmtPeso(ticket.peso_t) || "-"}`,
    ``,
    `🔗 Link (curto): ${linkCurto}`,
  ].join("\n");

  return (
    <div
      style={{
        maxWidth: 760,
        margin: "24px auto",
        padding: "0 16px",
        fontFamily: "system-ui",
      }}
    >
      <h1 style={{ margin: "0 0 12px 0" }}>
        Ticket #{ticket.id} {ticket.tipo ? `(${ticket.tipo})` : ""}
      </h1>

      <div style={{ lineHeight: 1.6 }}>
        <div>
          <b>Veículo:</b> {ticket.veiculo || "-"}
        </div>
        <div>
          <b>Data:</b> {fmtDateBR(ticket.data) || "-"}
        </div>
        <div>
          <b>Horário:</b> {ticket.horario || "-"}
        </div>
        <div>
          <b>Origem:</b> {ticket.origem || "-"}
        </div>
        <div>
          <b>Destino:</b> {ticket.destino || "-"}
        </div>
        <div>
          <b>Material:</b> {ticket.material || "-"}
        </div>
        <div>
          <b>Peso (t):</b> {fmtPeso(ticket.peso_t) || "-"}
        </div>
      </div>

      {signedUrl ? (
        <div style={{ marginTop: 16 }}>
          <a href={signedUrl} target="_blank" rel="noreferrer">
            Abrir foto do ticket
          </a>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <div style={{ fontWeight: 700, marginBottom: 6 }}>
          Texto pra copiar e colar no WhatsApp
        </div>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            background: "#f3f4f6",
            padding: 12,
            borderRadius: 10,
            overflow: "auto",
          }}
        >
          {texto}
        </pre>
      </div>
    </div>
  );
}
