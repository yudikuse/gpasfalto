// FILE: app/t/[id]/page.tsx
export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
};

export default function TicketPage({ params }: PageProps) {
  return (
    <main style={{ padding: 24, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial" }}>
      <h1 style={{ margin: 0, fontSize: 28 }}>Ticket</h1>

      <div
        style={{
          marginTop: 16,
          border: "1px solid #f1b2b2",
          background: "#fff5f5",
          color: "#b42318",
          padding: 12,
          borderRadius: 10,
          maxWidth: 720,
        }}
      >
        <strong>Compartilhamento por link desativado.</strong>
        <div style={{ marginTop: 6, color: "#7a271a" }}>
          ID recebido: <code>{params.id}</code>
        </div>
      </div>

      <p style={{ marginTop: 16, color: "#555", maxWidth: 720, lineHeight: 1.5 }}>
        O ticket é compartilhado direto no WhatsApp (foto). Se um dia você quiser voltar com link curto,
        a gente faz direito e sem depender de gambiarra.
      </p>
    </main>
  );
}
