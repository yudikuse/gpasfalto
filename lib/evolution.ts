// FILE: lib/evolution.ts
// Integração com WaSenderAPI (wasenderapi.com) para envio de mensagens WhatsApp

// Variáveis configuradas no painel da Vercel → Settings → Environment Variables
const WASENDER_API_KEY  = process.env.WASENDER_API_KEY!;
// Número individual: +5534999990000  (com + e código do país)
// Grupo:            120363XXXXXXXXX@g.us
const WHATSAPP_DESTINO  = process.env.WHATSAPP_DESTINO!;

export async function enviarMensagemWhatsApp(texto: string): Promise<void> {
  const res = await fetch("https://www.wasenderapi.com/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${WASENDER_API_KEY}`,
    },
    body: JSON.stringify({
      to:   WHATSAPP_DESTINO,
      text: texto,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WaSenderAPI erro ${res.status}: ${body}`);
  }
}
