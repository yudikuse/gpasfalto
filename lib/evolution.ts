// FILE: lib/evolution.ts
// Integração com Z-API (zapi.io) para envio de mensagens WhatsApp

// Variáveis configuradas no painel da Vercel → Settings → Environment Variables
const ZAPI_INSTANCE     = process.env.ZAPI_INSTANCE!;      // ID da instância — ex: 3DD...
const ZAPI_TOKEN        = process.env.ZAPI_TOKEN!;         // Token da instância — ex: F9A...
const ZAPI_CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN!;  // Security token — gerado no painel
const WHATSAPP_DESTINO  = process.env.WHATSAPP_DESTINO!;
// Número individual: 5534999990000  (55 + DDD + número, sem + ou espaços)
// Grupo:            120363XXXXXXXXX-group

export async function enviarMensagemWhatsApp(texto: string): Promise<void> {
  const url = `https://api.z-api.io/instances/${ZAPI_INSTANCE}/token/${ZAPI_TOKEN}/send-text`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Token": ZAPI_CLIENT_TOKEN,
    },
    body: JSON.stringify({
      phone: WHATSAPP_DESTINO,
      message: texto,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Z-API erro ${res.status}: ${body}`);
  }
}
