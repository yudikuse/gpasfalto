// FILE: lib/evolution.ts
// Integração com WaSenderAPI (wasenderapi.com) para envio de mensagens WhatsApp
//
// WHATSAPP_DESTINO aceita um ou mais destinatários separados por vírgula:
//   Um número:   +5564999452124
//   Vários:      +5564999452124,+5511999887766
//   Grupo:       120363XXXXXXXXX@g.us

const WASENDER_API_KEY = process.env.WASENDER_API_KEY!;
const WHATSAPP_DESTINO = process.env.WHATSAPP_DESTINO!;

async function enviarParaUm(to: string, texto: string): Promise<void> {
  const res = await fetch("https://www.wasenderapi.com/api/send-message", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${WASENDER_API_KEY}`,
    },
    body: JSON.stringify({ to: to.trim(), text: texto }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WaSenderAPI erro ${res.status} para ${to}: ${body}`);
  }
}

export async function enviarMensagemWhatsApp(texto: string): Promise<void> {
  const destinatarios = WHATSAPP_DESTINO
    .split(",")
    .map(d => d.trim())
    .filter(Boolean);

  for (let i = 0; i < destinatarios.length; i++) {
    await enviarParaUm(destinatarios[i], texto);
    // Aguarda 65s entre envios para respeitar o rate limit do trial (1 msg/min)
    if (i < destinatarios.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 65_000));
    }
  }
}
