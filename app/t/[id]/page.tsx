// FILE: app/t/[id]/page.tsx
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function getEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

  // aceita anon (legacy) ou publishable (novo) — sem te obrigar a entender isso agora
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    "";

  return { url, key };
}

function getSiteUrl() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://gpasfalto.vercel.app";
}

function asNumberId(idRaw: any) {
  const n = Number(String(idRaw || "").trim());
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return Math.trunc(n);
}

export default async function TicketPage(props: any) {
  const id = asNumberId(props?.params?.id);

  if (!id) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Ticket</h1>
        <div style={{ marginTop: 8, color: "#b00020" }}>ID inválido.</div>
      </main>
    );
  }

  const { url, key } = getEnv();
  if (!url || !key) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Ticket</h1>
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #ffb4b4",
            background: "#fff5f5",
            borderRadius: 10,
            maxWidth: 720,
          }}
        >
          <b>Erro</b>
          <div style={{ marginTop: 6 }}>
            Faltam variáveis <code>NEXT_PUBLIC_SUPABASE_URL</code> /{" "}
            <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no Vercel.
          </div>
        </div>
      </main>
    );
  }

  const supabase = createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase
    .from("material_tickets")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Ticket</h1>
        <div
          style={{
            marginTop: 12,
            padding: 12,
            border: "1px solid #ffb4b4",
            background: "#fff5f5",
            borderRadius: 10,
            maxWidth: 720,
          }}
        >
          <b>Erro ao buscar no Supabase</b>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>
            {error.message}
          </div>
        </div>
      </main>
    );
  }

  if (!data) {
    return (
      <main style={{ padding: 24, fontFamily: "system-ui" }}>
        <h1>Ticket</h1>
        <div style={{ marginTop: 8 }}>Ticket não encontrado (id {id}).</div>
      </main>
    );
  }

  const row: any = data;

  // tenta achar um link de foto já pronto no registro
  const photoUrl =
    row?.foto_url ||
    row?.link_foto ||
    row?.arquivo_url ||
    row?.signed_url ||
    row?.url ||
    null;

  // se tiver só o path, tenta montar public URL (só funciona se o bucket for público)
  const arquivoPath = row?.arquivo_path || row?.path || null;
  const bucket = row?.bucket || "tickets";
  const publicFromPath =
    arquivoPath && url
      ? `${url}/storage/v1/object/public/${bucket}/${arquivoPath}`
      : null;

  const finalPhoto = photoUrl || publicFromPath;

  const siteUrl = getSiteUrl();
  const shareUrl = `${siteUrl}/t/${id}`;

  const linha = (label: string, value: any) => (
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <div style={{ width: 120, opacity: 0.7 }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value ?? "-"}</div>
    </div>
  );

  return (
    <main
      style={{
        padding: 24,
        fontFamily: "system-ui",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "min(900px, 100%)" }}>
        <h1 style={{ margin: 0 }}>Ticket</h1>

        <div
          style={{
            marginTop: 12,
            padding: 14,
            border: "1px solid #e7e7e7",
            borderRadius: 12,
            background: "#fff",
          }}
        >
          {linha("ID", row?.id)}
          {linha("Tipo", row?.tipo)}
          {linha("Veículo", row?.veiculo)}
          {linha("Data", row?.data || row?.data_br)}
          {linha("Horário", row?.horario)}
          {linha("Origem", row?.origem)}
          {linha("Destino", row?.destino)}
          {linha("Material", row?.material)}
          {linha("Peso (t)", row?.peso_t ?? row?.peso_mask)}

          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid #eee" }}>
            <div style={{ opacity: 0.7, marginBottom: 6 }}>Compartilhamento</div>
            <div style={{ fontWeight: 600 }}>{shareUrl}</div>
          </div>
        </div>

        {finalPhoto ? (
          <div style={{ marginTop: 14 }}>
            <div style={{ opacity: 0.7, marginBottom: 6 }}>Foto</div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={finalPhoto}
              alt="Ticket"
              style={{
                width: "100%",
                maxHeight: 520,
                objectFit: "contain",
                borderRadius: 12,
                border: "1px solid #e7e7e7",
                background: "#fff",
              }}
            />
          </div>
        ) : (
          <div style={{ marginTop: 14, opacity: 0.7 }}>
            (Sem link de foto no registro)
          </div>
        )}
      </div>
    </main>
  );
}
