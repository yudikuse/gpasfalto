// FILE: app/t/[id]/page.tsx
export const dynamic = "force-dynamic";

export default function TicketLinkDisabledPage({
  params,
}: {
  params: { id?: string };
}) {
  const id = (params?.id ?? "").toString().trim();

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-3xl font-semibold text-gray-900">Ticket</h1>

        <div className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800">
          <div className="font-semibold">Compartilhamento por link desativado</div>
          <div className="mt-1 text-sm">ID recebido: {id || "—"}</div>
        </div>

        <p className="mt-4 text-sm text-gray-700">
          O ticket é compartilhado direto no WhatsApp (foto). Se um dia você quiser
          voltar com link curto, a gente faz direito e sem depender de gambiarra.
        </p>
      </div>
    </main>
  );
}
