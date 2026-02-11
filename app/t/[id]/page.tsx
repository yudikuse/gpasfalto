// FILE: app/t/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type TicketRow = {
  id: number;
  tipo: string | null; // "ENTRADA" | "SAIDA"
  veiculo: string | null;
  data: string | null; // date no formato "YYYY-MM-DD" ou "DD/MM/YY"
  horario: string | null; // "HH:MM:SS"
  origem: string | null;
  destino: string | null;
  material: string | null;
  peso: number | null;
  arquivo_path: string | null; // ex: "material/2026-01-15/xxx.jpg"
  created_at?: string | null;
};

function getAppBaseUrl() {
  // tenta usar URL do ambiente primeiro (mais confiável em produção)
  const env =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  if (env) return env.replace(/\/+$/, "");
  return "https://gpasfalto.vercel.app";
}

function getSupabaseConfig() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  // no seu projeto já aparece muito como PUBLISHABLE_DEFAULT_KEY
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_PUBLIC_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  return { url, key };
}

function formatDateBR(s: string | null) {
  if (!s) return "";
  // já pode vir "DD/MM/YY"
  if (/^\d{2}\/\d{2}\/\d{2,4}$/.test(s)) return s.length === 8 ? s : s.slice(0, 8);

  // "YYYY-MM-DD"
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1].slice(2)}`;
  return s;
}

function formatPeso(p: number | null) {
  if (p === null || !Number.isFinite(p)) return "";
  return Number(p).toFixed(3);
}

function buildTicketText(t: TicketRow, shareUrl: string) {
  const tipo = (t.tipo || "").toUpperCase().includes("ENTR") ? "ENTRADA" : "SAÍDA";
  const dt = `${formatDateBR(t.data)} ${t.horario || ""}`.trim();

  const lines = [
    `✅ Ticket de ${tipo}`,
    `ID: ${t.id}`,
    `Veículo: ${t.veiculo || "-"}`,
    `Data/Hora: ${dt || "-"}`,
    `Origem: ${t.origem || "-"}`,
    `Destino: ${t.destino || "-"}`,
    `Material: ${t.material || "-"}`,
    `Peso (t): ${formatPeso(t.peso) || "-"}`,
    ``,
    `🔗 Link curto: ${shareUrl}`,
  ];

  return lines.join("\n");
}

export default async function TicketSharePage({
  params,
}: {
  params: { id: string };
}) {
  const idNum = Number(params?.id);
  if (!Number.isFinite(idNum) || idNum <= 0) {
    return (
      <main style={{ padding: 16, fontFamily: "system-ui" }}>
        <h1 style={{ margin: 0 }}>Ticket</h1>
        <p style={{ marginTop: 8 }}>ID inválido.</p>
      </main>
    );
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    return (
      <main style={{ padding: 16, fontFamily: "system-ui" }}>
        <h1 style={{ margin: 0 }}>Ticket</h1>
        <p style={{ marginTop: 8 }}>
          Faltam variáveis do Supabase:
          <br />
          - NEXT_PUBLIC_SUPABASE_URL
          <br />
          - NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY (ou NEXT_PUBLIC_SUPABASE_ANON_KEY)
        </p>
      </main>
    );
  }

  const supabase = createClient(url, key);

  const { data: ticket, error } = await supabase
    .from("material_tickets")
    .select("*")
    .eq("id", idNum)
    .maybeSingle<TicketRow>();

  if (error || !ticket) {
    return (
      <main style={{ padding: 16, fontFamily: "system-ui" }}>
        <h1 style={{ margin: 0 }}>Ticket</h1>
        <p style={{ marginTop: 8 }}>Ticket não encontrado.</p>
      </main>
    );
  }

  const baseUrl = getAppBaseUrl();
  const shareUrl = `${baseUrl}/t/${ticket.id}`;

  // pega URL assinada da foto (não fica “curta”, mas fica só dentro da página)
  let imageUrl: string | null = null;
  if (ticket.arquivo_path) {
    const { data } = await supabase.storage
      .from("tickets")
      .createSignedUrl(ticket.arquivo_path, 60 * 60 * 24 * 7); // 7 dias
    imageUrl = data?.signedUrl || null;
  }

  const waText = buildTicketText(ticket, shareUrl);
  const waLink = `https://wa.me/?text=${encodeURIComponent(waText)}`;

  return (
    <main style={{ padding: 16, fontFamily: "system-ui", maxWidth: 820, margin: "0 auto" }}>
      <h1 style={{ margin: 0 }}>Ticket</h1>
      <p style={{ marginTop: 6, opacity: 0.8 }}>Compartilhamento (link curto)</p>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <a
          href={waLink}
          target="_blank"
          rel="noreferrer"
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            background: "#111827",
            color: "white",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Compartilhar no WhatsApp
        </a>

        <a
          href={shareUrl}
          style={{
            display: "inline-block",
            padding: "10px 14px",
            borderRadius: 10,
            background: "#f3f4f6",
            color: "#111827",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Copiar/abrir link curto
        </a>
      </div>

      {imageUrl ? (
        <div style={{ marginTop: 16 }}>
          <img
            src={imageUrl}
            alt={`Ticket ${ticket.id}`}
            style={{
              width: "100%",
              maxHeight: 520,
              objectFit: "contain",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              background: "#fff",
            }}
          />
        </div>
      ) : (
        <p style={{ marginTop: 16, opacity: 0.8 }}>Sem foto associada.</p>
      )}

      <div
        style={{
          marginTop: 16,
          padding: 12,
          borderRadius: 12,
          border: "1px solid #e5e7eb",
          background: "#fff",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
        }}
      >
        {waText}
      </div>
    </main>
  );
}
