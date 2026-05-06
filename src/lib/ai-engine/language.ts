// src/lib/ai-engine/language.ts
//
// Resolves the language the AI should speak in, based on (in order):
//   1. Explicit language override at AIConfig.persona.language (!= "auto")
//   2. Campaign-level override stored in campaign.metadata.aiLanguage
//   3. Language derived from the first country the campaign targets
//      (campaign.metadata.countries[0])
//   4. "auto" — let the LLM detect from the lead's own writing
//
// All language codes returned here are **BCP-47 short** (pt, en, es, de, fr,
// it, ja, nl, pt-BR specifically, …). Never use country codes as languages.

export type LanguageCode =
  | "auto"
  | "pt-BR"
  | "pt"
  | "en"
  | "es"
  | "de"
  | "fr"
  | "it"
  | "nl"
  | "ja";

const COUNTRY_TO_LANGUAGE: Record<string, LanguageCode> = {
  BR: "pt-BR",
  PT: "pt",
  US: "en",
  GB: "en",
  AU: "en",
  CA: "en",
  IE: "en",
  NZ: "en",
  ES: "es",
  MX: "es",
  AR: "es",
  CO: "es",
  CL: "es",
  PE: "es",
  UY: "es",
  VE: "es",
  DE: "de",
  AT: "de",
  CH: "de",
  FR: "fr",
  BE: "fr",
  IT: "it",
  NL: "nl",
  JP: "ja",
  CZ: "en", // fallback — the company most likely advertises in EN in Czechia
};

export const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  auto: "auto",
  "pt-BR": "português do Brasil",
  pt: "português",
  en: "English",
  es: "español",
  de: "Deutsch",
  fr: "français",
  it: "italiano",
  nl: "Nederlands",
  ja: "日本語",
};

export interface LanguageInputs {
  /** AIConfig.persona.language. "auto" or explicit code. */
  personaLanguage?: string;
  /** Campaign-level override (metadata.aiLanguage). Wins over country mapping. */
  campaignLanguage?: string;
  /** First country targeted by the campaign — ISO-3166-1 alpha-2 code. */
  campaignCountry?: string;
}

export interface ResolvedLanguage {
  /** Language to use, or "auto" to let the LLM decide */
  code: LanguageCode;
  /** Human-readable name for prompt building */
  name: string;
  /** Which source won */
  source: "persona" | "campaign" | "country" | "auto";
}

export function resolveLanguage(inputs: LanguageInputs): ResolvedLanguage {
  // 1. explicit persona override
  const persona = normalize(inputs.personaLanguage);
  if (persona && persona !== "auto" && isKnown(persona)) {
    return { code: persona, name: LANGUAGE_NAMES[persona], source: "persona" };
  }

  // 2. campaign-level override
  const campaign = normalize(inputs.campaignLanguage);
  if (campaign && campaign !== "auto" && isKnown(campaign)) {
    return { code: campaign, name: LANGUAGE_NAMES[campaign], source: "campaign" };
  }

  // 3. country of campaign
  if (inputs.campaignCountry) {
    const mapped = COUNTRY_TO_LANGUAGE[inputs.campaignCountry.toUpperCase()];
    if (mapped) return { code: mapped, name: LANGUAGE_NAMES[mapped], source: "country" };
  }

  // 4. auto — detect from lead text
  return { code: "auto", name: LANGUAGE_NAMES.auto, source: "auto" };
}

function normalize(v: unknown): LanguageCode | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const s = v.trim();
  // pt-BR must keep the region
  if (/^pt[-_]br$/i.test(s)) return "pt-BR";
  const short = s.split(/[-_]/)[0].toLowerCase();
  if (short === "auto") return "auto";
  if (isKnown(short as LanguageCode)) return short as LanguageCode;
  return null;
}

function isKnown(c: string): c is LanguageCode {
  return c in LANGUAGE_NAMES;
}
