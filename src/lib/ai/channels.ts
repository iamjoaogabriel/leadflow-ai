// src/lib/ai/channels.ts
/**
 * Channel senders for AI Engine.
 * - WhatsApp: Evolution API v2
 * - Email: Resend
 * - SMS: Twilio
 */

const EVOLUTION_URL = process.env.EVOLUTION_API_URL || "";
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY || "";

/* ═══ WHATSAPP via Evolution API v2 ═══ */
export async function sendWhatsApp(
  phone: string, message: string, channelConfig: any, accountId: string
) {
  const instanceName = channelConfig?.instanceName || accountId;
  const apiUrl = EVOLUTION_URL || channelConfig?.apiUrl;
  const apiKey = EVOLUTION_KEY || channelConfig?.apiKey;

  if (!apiUrl || !apiKey) throw new Error("Evolution API not configured");

  // Normalize phone: remove +, spaces, dashes
  const cleanPhone = phone.replace(/[\s\-\+\(\)]/g, "");
  // Ensure it has country code
  const remoteJid = cleanPhone.includes("@") ? cleanPhone : `${cleanPhone}@s.whatsapp.net`;

  const response = await fetch(`${apiUrl}/message/sendText/${instanceName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: apiKey },
    body: JSON.stringify({
      number: remoteJid,
      text: message,
      delay: randomDelay(), // Humanize: random typing delay
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Evolution API error ${response.status}: ${err}`);
  }

  return response.json();
}

/* ═══ EMAIL via Resend ═══ */
export async function sendEmail(
  to: string, name: string, message: string, channelConfig: any
) {
  const apiKey = channelConfig?.resendApiKey;
  const fromName = channelConfig?.fromName || "AI Assistant";
  const fromEmail = channelConfig?.fromEmail;

  if (!apiKey || !fromEmail) throw new Error("Resend not configured");

  // Convert plain text to simple HTML
  const htmlMessage = message
    .split("\n")
    .map(line => line.trim() ? `<p style="margin:0 0 8px 0;font-family:Arial,sans-serif;font-size:14px;color:#333;">${line}</p>` : "<br/>")
    .join("");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: `${fromName} — ${name}`,
      html: `<div style="max-width:500px;padding:20px;">${htmlMessage}</div>`,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Resend error ${response.status}: ${err}`);
  }

  return response.json();
}

/* ═══ SMS via Twilio ═══ */
export async function sendSMS(
  to: string, message: string, channelConfig: any
) {
  const accountSid = channelConfig?.accountSid;
  const authToken = channelConfig?.authToken;
  const from = channelConfig?.phoneNumber;

  if (!accountSid || !authToken || !from) throw new Error("Twilio not configured");

  const cleanTo = to.startsWith("+") ? to : `+${to}`;

  const params = new URLSearchParams({
    To: cleanTo,
    From: from,
    Body: message,
  });

  // If messaging service SID is available, use it instead of From
  if (channelConfig.messagingServiceSid) {
    params.delete("From");
    params.set("MessagingServiceSid", channelConfig.messagingServiceSid);
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Twilio error ${response.status}: ${err}`);
  }

  return response.json();
}

/* ═══ HUMANIZATION ═══ */
function randomDelay(): number {
  // Random delay between 1000-3000ms to simulate typing
  return Math.floor(Math.random() * 2000) + 1000;
}