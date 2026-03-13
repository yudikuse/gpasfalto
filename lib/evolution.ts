// FILE: lib/evolution.ts

const EVOLUTION_URL      = process.env.EVOLUTION_API_URL!;
const EVOLUTION_KEY      = process.env.EVOLUTION_API_KEY!;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE!;
const WHATSAPP_DESTINO   = process.env.WHATSAPP_DESTINO!;

export async function enviarMensagemWhatsApp(texto: string): Promise<void> {
  const url = `${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: EVOLUTION_KEY,
    },
    body: JSON.stringify({
      number: WHATSAPP_DESTINO,
      text: texto,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Evolution API erro ${res.status}: ${body}`);
  }
}
