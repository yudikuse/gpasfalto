// FILE: app/t/[id]/page.tsx

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <main
      style={{
        padding: 24,
        fontFamily:
          "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
      }}
    >
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>
        Ticket
      </h1>

      <div
        style={{
          border: "1px solid #f3b4b4",
          background: "#fff5f5",
          color: "#7a1a1a",
          padding: 12,
          borderRadius: 10,
          maxWidth: 760,
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 4 }}>
          Compartilhamento por link desativado
        </div>
        <div style={{ fontSize: 14 }}>
          ID recebido: <b>{id || "(vazio)"}</b>
        </div>
      </div>

      <p style={{ marginTop: 12, color: "#555", maxWidth: 760 }}>
        O ticket é compartilhado direto no WhatsApp (foto). Se um dia você quiser
        voltar com link curto, a gente faz direito e sem depender de gambiarra.
      </p>
    </main>
  );
}
