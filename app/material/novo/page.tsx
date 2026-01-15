// FILE: app/material/novo/page.tsx
"use client";

export default function MaterialTicketNovoPage() {
  return (
    <main
      style={{
        padding: 24,
        maxWidth: 920,
        margin: "0 auto",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial",
      }}
    >
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900 }}>
        Ticket de Materiais
      </h1>
      <p style={{ marginTop: 8, color: "#475569", lineHeight: 1.5 }}>
        Nova tela para upload e leitura de tickets de entrada/saída de materiais.
      </p>

      <div
        style={{
          marginTop: 16,
          border: "1px solid #e5e7eb",
          borderRadius: 16,
          padding: 16,
          background: "#fff",
        }}
      >
        <div style={{ fontWeight: 800, marginBottom: 8 }}>Status</div>
        <div style={{ color: "#334155" }}>
          Rota OK. Em seguida vamos adicionar o formulário + upload.
        </div>
      </div>
    </main>
  );
}
