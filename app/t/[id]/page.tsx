// FILE: app/t/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

type TicketRow = {
  id: number;
  created_at: string;
  tipo: string | null;
  veiculo: string | null;
  origem: string | null;
  destino: string | null;
  material: string | null;
  data: string | null; // YYYY-MM-DD
  horario: string | null; // HH:mm:ss
  peso_t: number | null;
  arquivo_path: string | null; // ex: material/2026-02-10/xxx.jpg
  arquivo_nome: string | null;
  arquivo_mime: string | null;
  arquivo_size: number | null;
};

function getBaseUrl() {
  // Sem headers() (Next 16 mudou e dá erro de TS se usar errado)
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (site) return site.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel}`;

  return "https://gpasfalto.vercel.app";
}

function getSupabase() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();

  // Prioriza a key nova do Supabase, mas aceita a legacy anon também
  const key = (
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    ""
  ).trim();

  if (!url || !key) {
    return { supabase: null as any, url, key };
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return { supabase, url, key };
}

function fmtPeso(peso: number | null) {
  if (peso === null || !Number.isFinite(peso)) return "-";
  return peso.toFixed(3).replace(".", ",");
}

function fmtDataHora(data: string | null, horario: string | null) {
  if (!data && !horario) return "-";
  const d = data ? data.split("-").reverse().join("/") : "";
  const h = horario ? horario : "";
  return `${d}${d && h ? " " : ""}${h}`.trim() || "-";
}

export default async function TicketPage({
  params,
}: {
  params: { id: string };
}) {
  const baseUrl = getBaseUrl();

  const idStr = (params?.id || "").trim();
  const idNum = Number.parseInt(idStr, 10);

  if (!idStr || !Number.isFinite(idNum) || idNum <= 0) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Ticket</h1>
        <div
          style={{
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            padding: 12,
            borderRadius: 10,
            maxWidth: 900,
          }}
        >
          <strong>Erro</strong>
          <div>ID inválido.</div>
        </div>
      </main>
    );
  }

  const { supabase, url, key } = getSupabase();

  if (!supabase) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Ticket</h1>
        <div
          style={{
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            padding: 12,
            borderRadius: 10,
            maxWidth: 900,
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>Erro</strong>
          <div>
            Faltam variáveis no Vercel:
            {"\n"}- NEXT_PUBLIC_SUPABASE_URL: {url ? "OK" : "FALTA"}
            {"\n"}- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT ou
            NEXT_PUBLIC_SUPABASE_ANON_KEY: {key ? "OK" : "FALTA"}
          </div>
        </div>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("material_tickets")
    .select(
      "id,created_at,tipo,veiculo,origem,destino,material,data,horario,peso_t,arquivo_path,arquivo_nome,arquivo_mime,arquivo_size"
    )
    .eq("id", idNum)
    .maybeSingle<TicketRow>();

  if (error) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Ticket</h1>
        <div
          style={{
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            padding: 12,
            borderRadius: 10,
            maxWidth: 900,
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>Erro</strong>
          <div>Falha ao buscar ticket no Supabase.</div>
          <div style={{ marginTop: 8 }}>{String(error.message || error)}</div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1 style={{ fontSize: 28, marginBottom: 8 }}>Ticket</h1>
        <div
          style={{
            border: "1px solid #fca5a5",
            background: "#fef2f2",
            padding: 12,
            borderRadius: 10,
            maxWidth: 900,
          }}
        >
          <strong>Não encontrado</strong>
          <div>Ticket #{idNum} não existe na tabela.</div>
        </div>
      </main>
    );
  }

  // tenta gerar signed URL (bucket privado). Se falhar, só não mostra a imagem.
  let signedUrl: string | null = null;
  if (data.arquivo_path) {
    try {
      const r = await supabase.storage
        .from("tickets")
        .createSignedUrl(data.arquivo_path, 60 * 60 * 24 * 7); // 7 dias
      signedUrl = r.data?.signedUrl || null;
    } catch {
      signedUrl = null;
    }
  }

  const shareTicketUrl = `${baseUrl}/t/${data.id}`;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <h1 style={{ fontSize: 34, marginBottom: 6 }}>Ticket</h1>
        <div style={{ color: "#555", marginBottom: 16 }}>
          Compartilhamento (link curto):{" "}
          <a href={shareTicketUrl} style={{ textDecoration: "underline" }}>
            {shareTicketUrl}
          </a>
        </div>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: 14,
            padding: 16,
            marginBottom: 16,
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <strong>ID:</strong> {data.id}
            </div>
            <div>
              <strong>Tipo:</strong> {data.tipo || "-"}
            </div>
            <div>
              <strong>Veículo:</strong> {data.veiculo || "-"}
            </div>
            <div>
              <strong>Data/Hora:</strong> {fmtDataHora(data.data, data.horario)}
            </div>
            <div>
              <strong>Origem:</strong> {data.origem || "-"}
            </div>
            <div>
              <strong>Destino:</strong> {data.destino || "-"}
            </div>
            <div>
              <strong>Material:</strong> {data.material || "-"}
            </div>
            <div>
              <strong>Peso (t):</strong> {fmtPeso(data.peso_t)}
            </div>
          </div>
        </div>

        {signedUrl ? (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 12,
            }}
          >
            <img
              src={signedUrl}
              alt={data.arquivo_nome || "ticket"}
              style={{ width: "100%", borderRadius: 10 }}
            />
          </div>
        ) : (
          <div style={{ color: "#666" }}>
            Foto indisponível (sem signedUrl). Path: {data.arquivo_path || "-"}
          </div>
        )}
      </div>
    </main>
  );
}
