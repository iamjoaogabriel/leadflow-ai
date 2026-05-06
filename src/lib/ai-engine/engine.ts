// src/lib/ai-engine/engine.ts
//
// Single source of truth for LLM-backed flows.
// All workers (first contact, AI response, follow-up, transcription) call
// AIEngine.* and never touch OpenAI/Anthropic directly.

import prisma from "@/lib/db/prisma";
import {
  findAvailableSlots,
  createEvent,
  getIntegrationStatus,
} from "@/lib/integrations/google-calendar";
import { getIntegrationStatus as getMetaStatus } from "@/lib/integrations/meta";
import { resolveLanguage, type ResolvedLanguage } from "@/lib/ai-engine/language";

type Channel = "WHATSAPP" | "EMAIL" | "SMS";

export type HistoryRole = "user" | "assistant";

export interface HistoryEntry {
  role: HistoryRole;
  content: string;
}

export interface FirstContactParams {
  accountId: string;
  leadName?: string;
  leadSource: string;
  campaignInfo?: string;
  channel: Channel;
  leadMetadata?: Record<string, unknown>;
  /** Country (ISO-2) of the campaign that brought this lead — drives language */
  campaignCountry?: string;
  /** Optional explicit language override coming from the campaign */
  campaignLanguage?: string;
}

export interface GenerateResponseParams {
  accountId: string;
  leadName?: string;
  leadPhone?: string;
  leadEmail?: string;
  leadSource: string;
  campaignInfo?: string;
  conversationHistory: HistoryEntry[];
  currentMessage: string;
  channel: Channel;
  leadMetadata?: Record<string, unknown>;
  campaignCountry?: string;
  campaignLanguage?: string;
}

export interface AIResponseResult {
  message: string;
  sentiment: "POSITIVE" | "NEUTRAL" | "NEGATIVE";
  tags: string[];
  isEscalation: boolean;
  isConversion: boolean;
  notificationMessage?: string;
  scheduled?: {
    eventId: string;
    startISO: string;
    endISO: string;
    htmlLink?: string;
  };
}

interface ScheduleIntent {
  startISO: string;
  endISO: string;
  summary?: string;
  attendeeEmail?: string;
  attendeeName?: string;
}

interface LoadedConfig {
  provider: "openai" | "anthropic";
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  persona: Record<string, unknown>;
  escalationKeywords: string[];
  conversionKeywords: string[];
  offHoursMessage: string;
}

export class AIEngine {
  // ════════════════════════════════════════════════════
  // FIRST CONTACT
  // ════════════════════════════════════════════════════
  static async generateFirstContact(params: FirstContactParams): Promise<string> {
    const cfg = await loadConfig(params.accountId);
    if (!cfg) return fallbackGreeting(params.leadName);

    const businessContext = await loadBusinessContext(
      params.accountId,
      params.leadMetadata
    );

    const language = resolveLanguage({
      personaLanguage: personaField(cfg.persona, "language", "auto") as string,
      campaignLanguage: params.campaignLanguage,
      campaignCountry: params.campaignCountry,
    });

    const systemPrompt = buildFirstContactSystemPrompt(
      cfg,
      params,
      businessContext,
      language
    );
    const userTurn = buildFirstContactUserTurn(params);

    const reply = await callLLM(cfg, systemPrompt, [
      { role: "user", content: userTurn },
    ]);

    return reply?.trim() || fallbackGreeting(params.leadName);
  }

  // ════════════════════════════════════════════════════
  // AI RESPONSE (reply to an inbound message)
  // ════════════════════════════════════════════════════
  static async generateResponse(
    params: GenerateResponseParams
  ): Promise<AIResponseResult> {
    const cfg = await loadConfig(params.accountId);
    if (!cfg) {
      return {
        message: fallbackGreeting(params.leadName),
        sentiment: "NEUTRAL",
        tags: [],
        isEscalation: false,
        isConversion: false,
      };
    }

    const escalation = matchesAny(params.currentMessage, cfg.escalationKeywords);
    const conversion = matchesAny(params.currentMessage, cfg.conversionKeywords);

    // ── Scheduling context (only when calendar is enabled + connected) ──
    const schedulingContext = await maybeLoadSchedulingContext(
      params.accountId,
      cfg
    );

    // ── Business context (Meta integration: business name/niche/offer + ad context) ──
    const businessContext = await loadBusinessContext(
      params.accountId,
      params.leadMetadata
    );

    const language = resolveLanguage({
      personaLanguage: personaField(cfg.persona, "language", "auto") as string,
      campaignLanguage: params.campaignLanguage,
      campaignCountry: params.campaignCountry,
    });

    const systemPrompt = buildResponseSystemPrompt(cfg, params, {
      escalation,
      conversion,
      schedulingContext,
      businessContext,
      language,
    });

    const messages: HistoryEntry[] = [
      ...params.conversationHistory,
      { role: "user", content: params.currentMessage },
    ];

    const rawReply =
      (await callLLM(cfg, systemPrompt, messages))?.trim() ||
      "Posso te ajudar em algo mais?";

    // ── Parse optional SCHEDULE:{...} block and act on it ──
    const parsed = extractScheduleBlock(rawReply);
    let visibleMessage = parsed.cleaned;
    let scheduled: AIResponseResult["scheduled"];

    if (parsed.intent && schedulingContext?.connected) {
      try {
        const ev = await createEvent(params.accountId, {
          summary:
            parsed.intent.summary ||
            `Reunião com ${params.leadName || params.leadPhone || "lead"}`,
          description: `Lead: ${params.leadName || ""} ${params.leadPhone || ""} ${params.leadEmail || ""}`.trim(),
          startISO: parsed.intent.startISO,
          endISO: parsed.intent.endISO,
          attendeeEmail: parsed.intent.attendeeEmail || params.leadEmail,
          attendeeName: parsed.intent.attendeeName || params.leadName,
          timeZone: schedulingContext.timeZone,
          sendUpdates: parsed.intent.attendeeEmail || params.leadEmail ? "all" : "none",
        });
        scheduled = {
          eventId: ev.eventId,
          startISO: parsed.intent.startISO,
          endISO: parsed.intent.endISO,
          htmlLink: ev.htmlLink,
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[AIEngine] createEvent failed:", msg);
        // Fall back: keep the message visible without confirmation of event
      }
    }

    return {
      message: visibleMessage,
      sentiment: analyzeSentiment(params.currentMessage),
      tags: collectTags({ escalation, conversion, scheduled: !!scheduled }),
      isEscalation: escalation,
      isConversion: conversion || !!scheduled,
      notificationMessage: escalation
        ? `Lead solicitou atendimento humano: ${params.leadName || params.leadPhone || params.leadEmail || "lead"}`
        : conversion
          ? `Lead demonstrou intenção de compra: ${params.leadName || params.leadPhone || params.leadEmail || "lead"}`
          : scheduled
            ? `Reunião agendada com ${params.leadName || params.leadPhone || "lead"} em ${scheduled.startISO}`
            : undefined,
      scheduled,
    };
  }

  // ════════════════════════════════════════════════════
  // AUDIO TRANSCRIPTION (OpenAI Whisper)
  // ════════════════════════════════════════════════════
  static async transcribeAudio(
    audio: Buffer | { buffer: Buffer; mimetype?: string },
    filename = "audio.ogg"
  ): Promise<string> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      console.warn("[AIEngine] OPENAI_API_KEY missing — skipping transcription");
      return "";
    }

    const buffer = Buffer.isBuffer(audio) ? audio : audio.buffer;
    const mimetype = Buffer.isBuffer(audio) ? "audio/ogg" : audio.mimetype || "audio/ogg";

    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimetype }), filename);
    form.append("model", "whisper-1");

    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`Whisper transcription failed: HTTP ${res.status} ${err}`);
    }

    const data = (await res.json()) as { text?: string };
    return (data.text || "").trim();
  }
}

// ════════════════════════════════════════════════════
// CONFIG LOADER
// ════════════════════════════════════════════════════
async function loadConfig(accountId: string): Promise<LoadedConfig | null> {
  const row = await prisma.aIConfig.findUnique({ where: { accountId } });
  if (!row) return null;

  const persona = (row.persona as Record<string, unknown>) || {};
  const escalation = (row.escalationConfig as Record<string, unknown>) || {};
  const conversion = (row.conversionConfig as Record<string, unknown>) || {};

  return {
    provider: (row.provider === "anthropic" ? "anthropic" : "openai"),
    model: row.model,
    systemPrompt: row.systemPrompt,
    temperature: row.temperature,
    maxTokens: row.maxTokens,
    persona,
    escalationKeywords: parseKeywords(
      (escalation.keywords as string | string[] | undefined) ||
        (persona.escalationTriggers as string | string[] | undefined)
    ),
    conversionKeywords: parseKeywords(
      (conversion.keywords as string | string[] | undefined) ||
        (persona.conversionTriggers as string | string[] | undefined)
    ),
    offHoursMessage: row.offHoursMessage || "",
  };
}

function parseKeywords(v: string | string[] | undefined): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  return String(v)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ════════════════════════════════════════════════════
// PROMPT BUILDERS
// ════════════════════════════════════════════════════
function personaField<T = string>(
  persona: Record<string, unknown>,
  key: string,
  fallback: T
): T {
  const v = persona[key];
  return (v === undefined || v === null || v === "" ? fallback : v) as T;
}

function commonPreamble(
  cfg: LoadedConfig,
  channel: Channel,
  resolved: ResolvedLanguage
): string {
  const aiName = personaField(cfg.persona, "aiName", "Assistente");
  const aiRole = personaField(cfg.persona, "aiRole", "Consultor de vendas");
  const tone = personaField(cfg.persona, "tone", "professional_friendly");

  const languageRule =
    resolved.code === "auto"
      ? "Detecte automaticamente o idioma da última mensagem do lead e responda SEMPRE no mesmo idioma."
      : `Responda SEMPRE em ${resolved.name}. Se o lead escrever em outro idioma, continue em ${resolved.name} a menos que ele peça explicitamente para trocar.`;

  return `Você é ${aiName}, ${aiRole}. Você é uma PESSOA REAL. JAMAIS revele que é uma IA, robô, bot ou automação. Se o lead perguntar, diga que trabalha na equipe há anos.

TREINAMENTO DA IA (seu contexto de atuação):
${cfg.systemPrompt}

TOM: ${String(tone).replace(/_/g, " ")}
IDIOMA: ${languageRule}
CANAL: ${channel === "WHATSAPP" ? "WhatsApp (mensagem curta e informal)" : channel === "EMAIL" ? "Email" : "SMS (ultra-curto)"}

════════════════════════════════════════════════════
FORMATO DE RESPOSTA — REGRA MAIS IMPORTANTE
════════════════════════════════════════════════════
Você NUNCA envia um textão em um balão só. No WhatsApp uma pessoa real manda várias mensagens curtas em sequência.

Separe cada balão com o delimitador literal: |||

Regras:
- Máximo 3 balões por resposta. Cada balão: 1 a 2 frases curtas.
- Pense como se você estivesse digitando no celular: uma ideia por balão.
- NUNCA envie listas numeradas, bullet points ou markdown (* ou - ou #). Isso é WhatsApp, não é documento.
- Se a resposta é curta (uma frase simples), 1 balão só está ótimo — não force a divisão.
- Emoji: no máximo 1 por resposta inteira (não por balão), e só se fizer sentido no contexto.

Exemplo bom:
Tudo certo ${aiName ? "" : ""}|||me conta rapidinho o que você procura?

Exemplo ruim (NÃO faça isso):
Olá! Tudo bem? Obrigado pelo seu contato. Gostaria de entender melhor o que você está buscando para poder te ajudar da melhor forma possível.

════════════════════════════════════════════════════
VÍCIOS DE LINGUAGEM PROIBIDOS (frases banidas)
════════════════════════════════════════════════════
Você NUNCA, em hipótese NENHUMA, usa estas frases ou variações delas:
- "Estou à disposição" / "Fico à disposição" / "Ficamos à disposição"
- "Qualquer dúvida me chama" / "Qualquer coisa me avisa"
- "Não hesite em perguntar"
- "Estou aqui para ajudar"
- "Pode contar comigo"
- "Fico no aguardo"
- "Espero ter ajudado"
- "Foi um prazer"

Se precisar encerrar uma mensagem, use SUBSTÂNCIA ou uma próxima ação concreta:
- BOM: "Me conta depois o que achou."
- BOM: "Assim que você olhar, me dá um retorno."
- BOM: "Vou te mandar mais detalhes em seguida."
- RUIM: qualquer frase da lista acima.

════════════════════════════════════════════════════
COMPORTAMENTO
════════════════════════════════════════════════════
- Nunca repita a saudação. Se você já disse "oi" antes, NÃO diga de novo. Entra direto no assunto.
- Nunca repita textualmente o que o lead acabou de falar. Avance a conversa.
- Nunca invente preço, prazo, política ou fato que não está no seu treinamento. Se não souber, diga "vou confirmar e te retorno".
- Nunca use o nome do lead em TODA mensagem — use ocasionalmente.
- Nunca diga que não consegue ouvir/processar áudio — o sistema já transcreveu pra você.
- Nunca envie o mesmo link duas vezes na mesma conversa.
- Nunca faça pergunta que o lead acabou de responder.
- Pode usar abreviações naturais de WhatsApp (vc, pra, tá, tb, tô) com moderação.
- Pode começar balão com letra minúscula. Depois de ponto final, maiúscula normal.

════════════════════════════════════════════════════
FOLLOW-UP PROGRAMADO (opcional)
════════════════════════════════════════════════════
Se o lead indicar que volta depois (ex.: "vou ver amanhã", "tô ocupado", "volto em X dias"), inclua no FIM da sua resposta uma tag invisível:
[FOLLOWUP:Xh]  (onde X é número, sufixo "h" para horas ou "d" para dias)

Exemplos:
- "vou ver amanhã" → [FOLLOWUP:24h]
- "tô ocupado agora" → [FOLLOWUP:6h]
- "volto semana que vem" → [FOLLOWUP:7d]

Essa tag é REMOVIDA antes de enviar ao lead — ele nunca a vê. Só use quando fizer sentido real.`;
}

function buildFirstContactSystemPrompt(
  cfg: LoadedConfig,
  params: FirstContactParams,
  businessContext: BusinessContext | null,
  language: ResolvedLanguage
): string {
  const firstMessageInstruction = personaField(
    cfg.persona,
    "firstMessageInstruction",
    "Apresente-se de forma curta e humana, confirme o interesse do lead e faça UMA pergunta aberta para começar a qualificação."
  );

  return `${commonPreamble(cfg, params.channel, language)}
${businessContext ? renderBusinessContext(businessContext) : ""}
CONTEXTO DESTE LEAD:
- Nome: ${params.leadName || "ainda não sabemos"}
- Origem: ${params.leadSource}
${params.campaignInfo ? `- Campanha: ${params.campaignInfo}` : ""}
${params.campaignCountry ? `- País da campanha: ${params.campaignCountry}` : ""}

SUA TAREFA AGORA:
Escrever a PRIMEIRA mensagem para este lead, separada em balões com |||. ${firstMessageInstruction}
NUNCA use template genérico ("Olá! Como posso te ajudar?" é proibido). Cada mensagem deve soar única.`;
}

function buildResponseSystemPrompt(
  cfg: LoadedConfig,
  params: GenerateResponseParams,
  flags: {
    escalation: boolean;
    conversion: boolean;
    schedulingContext?: SchedulingContext | null;
    businessContext?: BusinessContext | null;
    language: ResolvedLanguage;
  }
): string {
  const pipelineGoal = personaField(cfg.persona, "pipelineGoal", "closeSale");
  const calendarEnabled = personaField<boolean>(
    cfg.persona,
    "pipelineCalendarEnabled",
    false
  );

  const goalInstruction = describeGoal(String(pipelineGoal), calendarEnabled);

  const escalationLine = flags.escalation
    ? "ATENÇÃO: O lead pediu atendimento humano ou demonstrou insatisfação séria. Avise com empatia que você vai conectar ele com um especialista agora e encerre sua resposta por aqui."
    : "";
  const conversionLine = flags.conversion
    ? "ATENÇÃO: O lead demonstrou intenção clara de compra. Conduza o fechamento — confirme o que ele quer, colete os dados que faltam e indique o próximo passo concreto (link de pagamento, agendamento, proposta)."
    : "";

  const schedulingBlock = flags.schedulingContext?.connected
    ? buildSchedulingBlock(flags.schedulingContext)
    : "";

  const businessBlock = flags.businessContext
    ? renderBusinessContext(flags.businessContext)
    : "";

  return `${commonPreamble(cfg, params.channel, flags.language)}
${businessBlock}
CONTEXTO DO LEAD:
- Nome: ${params.leadName || "desconhecido"}
- Telefone: ${params.leadPhone || "—"}
- Email: ${params.leadEmail || "—"}
- Origem: ${params.leadSource}
${params.campaignInfo ? `- Campanha: ${params.campaignInfo}` : ""}

OBJETIVO DO FUNIL:
${goalInstruction}

${escalationLine}
${conversionLine}
${schedulingBlock}

OBSERVAÇÃO SOBRE DEBOUNCE:
O lead pode ter enviado várias mensagens seguidas. Elas aparecem juntas na última fala como "user". Responda a TUDO de uma vez, de forma coesa, como se tivesse lido tudo antes de responder.`;
}

interface SchedulingContext {
  connected: boolean;
  timeZone: string;
  durationMinutes: number;
  slots: { startISO: string; endISO: string }[];
}

async function maybeLoadSchedulingContext(
  accountId: string,
  cfg: LoadedConfig
): Promise<SchedulingContext | null> {
  const goal = String(personaField(cfg.persona, "pipelineGoal", "closeSale"));
  const calendarEnabled = personaField<boolean>(
    cfg.persona,
    "pipelineCalendarEnabled",
    false
  );
  if (goal !== "scheduleMeeting" || !calendarEnabled) return null;

  const status = await getIntegrationStatus(accountId);
  if (!status.connected) return null;

  const durationMinutes = Number(
    personaField(cfg.persona, "pipelineMeetingDuration", 30)
  );
  const businessHoursStart = Number(
    personaField(cfg.persona, "pipelineBusinessHoursStart", 9)
  );
  const businessHoursEnd = Number(
    personaField(cfg.persona, "pipelineBusinessHoursEnd", 18)
  );
  const timeZone = String(
    personaField(cfg.persona, "pipelineTimeZone", "America/Sao_Paulo")
  );

  let slots: { startISO: string; endISO: string }[] = [];
  try {
    slots = await findAvailableSlots(accountId, {
      durationMinutes,
      days: 7,
      businessHoursStart,
      businessHoursEnd,
      timeZone,
      maxSlots: 8,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[AIEngine] findAvailableSlots failed:", msg);
  }

  return { connected: true, timeZone, durationMinutes, slots };
}

function buildSchedulingBlock(ctx: SchedulingContext): string {
  const slotList = ctx.slots.length
    ? ctx.slots
        .map((s, i) => `  ${i + 1}. ${formatSlotLabel(s.startISO, ctx.timeZone)} (start=${s.startISO}, end=${s.endISO})`)
        .join("\n")
    : "  (sem horários disponíveis nos próximos 7 dias)";

  return `
AGENDAMENTO GOOGLE CALENDAR — INSTRUÇÕES CRÍTICAS:
Você pode agendar uma reunião de ${ctx.durationMinutes} min no calendário. Os slots abaixo já foram filtrados pelos horários comerciais e ocupações atuais do calendário — ofereça 2 ou 3 em linguagem natural ao lead.

SLOTS DISPONÍVEIS (timezone ${ctx.timeZone}):
${slotList}

QUANDO O LEAD CONFIRMAR um horário específico:
1) Confirme o horário em linguagem natural na sua resposta visível.
2) No FINAL da sua resposta, adicione (sem anunciar) uma linha exatamente no formato:
SCHEDULE: {"startISO":"<ISO>","endISO":"<ISO>","summary":"<título>","attendeeName":"<nome do lead>","attendeeEmail":"<email se o lead deu>"}
3) Use EXATAMENTE os valores startISO/endISO de um dos slots acima — não invente horários.
4) Se o lead ainda estiver indeciso ou pedir outro horário, NÃO emita SCHEDULE. Apenas ofereça alternativas.
5) A linha SCHEDULE é removida antes do envio ao lead — nunca a cite na fala visível.`;
}

function formatSlotLabel(iso: string, tz: string): string {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const SCHEDULE_BLOCK_RE = /SCHEDULE:\s*(\{[\s\S]*?\})/i;

function extractScheduleBlock(
  raw: string
): { cleaned: string; intent: ScheduleIntent | null } {
  const match = raw.match(SCHEDULE_BLOCK_RE);
  if (!match) return { cleaned: raw, intent: null };

  const cleaned = raw.replace(SCHEDULE_BLOCK_RE, "").trim();
  try {
    const parsed = JSON.parse(match[1]) as Partial<ScheduleIntent>;
    if (!parsed.startISO || !parsed.endISO) {
      return { cleaned, intent: null };
    }
    return {
      cleaned,
      intent: {
        startISO: parsed.startISO,
        endISO: parsed.endISO,
        summary: parsed.summary,
        attendeeEmail: parsed.attendeeEmail,
        attendeeName: parsed.attendeeName,
      },
    };
  } catch {
    return { cleaned, intent: null };
  }
}

function describeGoal(goal: string, calendarEnabled: boolean): string {
  switch (goal) {
    case "scheduleMeeting":
      return calendarEnabled
        ? "Qualificar o lead e agendar uma reunião no calendário. Pergunte disponibilidade e confirme o horário."
        : "Qualificar o lead e agendar uma reunião com o time comercial.";
    case "qualifyTransfer":
      return "Fazer as perguntas de qualificação e preparar a transferência para um vendedor humano.";
    case "collectSend":
      return "Coletar as informações-chave do lead e indicar que a proposta/material será enviado em seguida.";
    case "closeSale":
    default:
      return "Conduzir a venda até o fechamento: entender a necessidade, tirar objeções e guiar para o próximo passo de compra.";
  }
}

function buildFirstContactUserTurn(params: FirstContactParams): string {
  const source = params.leadSource;
  const name = params.leadName ? ` O nome dele é ${params.leadName}.` : "";
  return `Um novo lead acabou de chegar via ${source}.${name} Escreva agora a primeira mensagem para ele no canal ${params.channel}.`;
}

// ════════════════════════════════════════════════════
// LLM CALLERS
// ════════════════════════════════════════════════════
async function callLLM(
  cfg: LoadedConfig,
  systemPrompt: string,
  messages: HistoryEntry[]
): Promise<string | null> {
  try {
    if (cfg.provider === "anthropic") {
      return await callAnthropic(cfg, systemPrompt, messages);
    }
    return await callOpenAI(cfg, systemPrompt, messages);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AIEngine] LLM call failed (${cfg.provider}):`, msg);
    return null;
  }
}

const LLM_TIMEOUT_MS = 30_000;
const LLM_MAX_RETRIES = 2;

/** fetch wrapper with timeout + exponential-backoff retry on 5xx/network. */
async function llmFetch(
  url: string,
  init: RequestInit,
  label: string
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= LLM_MAX_RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      clearTimeout(timer);
      // Retry only on transient errors
      if (res.status >= 500 || res.status === 429) {
        const body = await res.text().catch(() => "");
        lastError = new Error(`${label} ${res.status}: ${body.slice(0, 300)}`);
        if (attempt < LLM_MAX_RETRIES) {
          await sleep(backoffMs(attempt));
          continue;
        }
        throw lastError;
      }
      return res;
    } catch (err: unknown) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < LLM_MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError ?? new Error(`${label} failed`);
}

function backoffMs(attempt: number): number {
  // 400ms, 1200ms, 3600ms — with ±25% jitter
  const base = 400 * Math.pow(3, attempt);
  const jitter = base * (Math.random() * 0.5 - 0.25);
  return Math.max(200, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function callOpenAI(
  cfg: LoadedConfig,
  systemPrompt: string,
  messages: HistoryEntry[]
): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY missing");

  const res = await llmFetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    },
    "OpenAI"
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(
  cfg: LoadedConfig,
  systemPrompt: string,
  messages: HistoryEntry[]
): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY missing");

  const res = await llmFetch(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: cfg.temperature,
        max_tokens: cfg.maxTokens,
        system: systemPrompt,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    },
    "Anthropic"
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: { text?: string }[] };
  return data.content?.[0]?.text?.trim() || "";
}

// ════════════════════════════════════════════════════
// TRIGGERS & SENTIMENT
// ════════════════════════════════════════════════════
const DEFAULT_ESCALATION = [
  "falar com humano",
  "falar com alguém",
  "atendente",
  "pessoa real",
  "talk to human",
  "real person",
  "agent",
  "hablar con alguien",
  "reclamação",
  "complaint",
  "queja",
  "problema grave",
];

function matchesAny(text: string, keywords: string[]): boolean {
  const list = keywords.length ? keywords : DEFAULT_ESCALATION;
  const lower = text.toLowerCase();
  return list.some((k) => k && lower.includes(k.toLowerCase()));
}

function analyzeSentiment(
  text: string
): "POSITIVE" | "NEUTRAL" | "NEGATIVE" {
  const positive =
    /obrigad|perfeito|ótimo|excelente|gostei|maravilh|thank|great|perfect|love|awesome|genial|incre[íi]ble/i;
  const negative =
    /horr[íi]vel|p[ée]ssimo|raiva|insatisf|cancel|terrible|awful|angry|furious|horrible|p[ée]simo|cancelar/i;
  if (positive.test(text)) return "POSITIVE";
  if (negative.test(text)) return "NEGATIVE";
  return "NEUTRAL";
}

function collectTags(flags: {
  escalation: boolean;
  conversion: boolean;
  scheduled?: boolean;
}): string[] {
  const tags: string[] = [];
  if (flags.escalation) tags.push("escalation");
  if (flags.conversion) tags.push("conversion");
  if (flags.scheduled) tags.push("scheduled");
  return tags;
}

function fallbackGreeting(name?: string): string {
  return name
    ? `Oi ${name}! Tudo bem? Obrigado pelo contato — me conta rapidinho o que você procura?`
    : "Oi! Tudo bem? Obrigado pelo contato — me conta rapidinho o que você procura?";
}

// ════════════════════════════════════════════════════
// BUSINESS CONTEXT (Meta integration + lead metadata)
// ════════════════════════════════════════════════════

interface BusinessContext {
  businessName?: string;
  businessNiche?: string;
  businessProduct?: string;
  platform?: string;
  adName?: string;
  campaignName?: string;
  customFields?: Record<string, string>;
}

async function loadBusinessContext(
  accountId: string,
  leadMetadata?: Record<string, unknown>
): Promise<BusinessContext | null> {
  const ctx: BusinessContext = {};
  let hasAny = false;

  // From MetaIntegration business fields (saved by the owner in Settings)
  try {
    const meta = await getMetaStatus(accountId);
    if (meta.connected) {
      if (meta.businessName) {
        ctx.businessName = meta.businessName;
        hasAny = true;
      }
      if (meta.businessNiche) {
        ctx.businessNiche = meta.businessNiche;
        hasAny = true;
      }
      if (meta.businessProduct) {
        ctx.businessProduct = meta.businessProduct;
        hasAny = true;
      }
    }
  } catch {
    // integration optional
  }

  // From lead metadata (leadgen event)
  if (leadMetadata && typeof leadMetadata === "object") {
    const m = leadMetadata as Record<string, unknown>;
    if (typeof m.platform === "string") {
      ctx.platform = m.platform;
      hasAny = true;
    }
    if (typeof m.adName === "string") {
      ctx.adName = m.adName;
      hasAny = true;
    }
    if (typeof m.campaignName === "string") {
      ctx.campaignName = m.campaignName;
      hasAny = true;
    }
    if (m.customFields && typeof m.customFields === "object") {
      const cf = m.customFields as Record<string, string>;
      if (Object.keys(cf).length > 0) {
        ctx.customFields = cf;
        hasAny = true;
      }
    }
  }

  return hasAny ? ctx : null;
}

function renderBusinessContext(ctx: BusinessContext): string {
  const parts: string[] = [];

  if (ctx.businessName || ctx.businessNiche || ctx.businessProduct) {
    parts.push("SOBRE O NEGÓCIO QUE VOCÊ REPRESENTA:");
    if (ctx.businessName) parts.push(`- Empresa: ${ctx.businessName}`);
    if (ctx.businessNiche) parts.push(`- Segmento: ${ctx.businessNiche}`);
    if (ctx.businessProduct)
      parts.push(`- Produto/Oferta principal: ${ctx.businessProduct}`);
    parts.push(
      "Use estas informações para responder com autoridade. Nunca invente números, preços ou políticas que não estejam descritos aqui — se o lead perguntar algo que você não tem, diga que vai confirmar com o time."
    );
    parts.push("");
  }

  if (ctx.platform || ctx.adName || ctx.campaignName) {
    parts.push("DE ONDE ESTE LEAD VEIO:");
    if (ctx.platform) parts.push(`- Plataforma: ${ctx.platform}`);
    if (ctx.campaignName) parts.push(`- Campanha: ${ctx.campaignName}`);
    if (ctx.adName) parts.push(`- Criativo/Anúncio: ${ctx.adName}`);
    parts.push(
      "Use esse contexto para confirmar o interesse do lead (ex.: 'vi que você veio pelo anúncio X') sem parecer invasivo."
    );
    parts.push("");
  }

  if (ctx.customFields && Object.keys(ctx.customFields).length > 0) {
    parts.push("RESPOSTAS QUE O LEAD JÁ DEU NO FORMULÁRIO DE CAMPANHA:");
    for (const [k, v] of Object.entries(ctx.customFields)) {
      parts.push(`- ${k}: ${v}`);
    }
    parts.push(
      "Não peça essas informações de novo. Use-as para tornar sua mensagem mais precisa."
    );
    parts.push("");
  }

  return parts.length ? `\n${parts.join("\n")}` : "";
}
