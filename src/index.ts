import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  getAllRates,
  getRate,
  validateFormat,
  isEUMember,
  dataVersion,
} from 'eu-vat-rates-data'

const VERSION = '0.3.0'
const API_BASE = process.env.VATNODE_API_URL ?? 'https://api.vatnode.dev'
const API_KEY = process.env.VATNODE_API_KEY
const USER_AGENT = `vatnode-mcp/${VERSION} (+https://vatnode.dev)`

const server = new McpServer({ name: 'vatnode', version: VERSION })

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
})

const err = (message: string, hint?: string) => ({
  isError: true,
  content: [
    {
      type: 'text' as const,
      text: hint ? `${message}\n\nHint: ${hint}` : message,
    },
  ],
})

function normalizeVatId(vatId: string): string {
  return vatId.toUpperCase().replace(/[\s-]/g, '')
}

function buildRate(countryCode: string) {
  const r = getRate(countryCode)
  if (!r) return null
  return {
    countryCode,
    countryName: r.country,
    vatName: r.vat_name,
    vatAbbr: r.vat_abbr,
    currency: r.currency,
    standardRate: r.standard,
    reducedRates: [...r.reduced].sort((a, b) => b - a),
    superReducedRate: r.super_reduced,
    parkingRate: r.parking,
    vatNumberFormat: r.format ?? null,
    vatNumberPattern: r.pattern ?? null,
    updatedAt: dataVersion,
  }
}

// XI (Northern Ireland) is not formally in the EU but the VIES service treats
// it as an EU member for VAT purposes — include it alongside the 27 member states.
const isVIESEligible = (code: string) => isEUMember(code) || code === 'XI'

const EU_COUNTRY_CODES = Object.keys(getAllRates())
  .filter(isVIESEligible)
  .sort()

// ---------------------------------------------------------------------------
// Free tools — no API key, no network (data bundled via eu-vat-rates-data)
// ---------------------------------------------------------------------------

server.registerTool(
  'list_eu_vat_rates',
  {
    title: 'List EU VAT rates',
    description:
      'Returns current VAT rates for all EU member states (plus XI for Northern Ireland). ' +
      'Read-only and offline: no network call, no API key, no rate limit, no side effects. Takes no arguments. ' +
      'Output: { rates: Array<{ countryCode, countryName, vatName, vatAbbr, currency, standardRate, reducedRates[], superReducedRate, parkingRate, vatNumberFormat, vatNumberPattern, updatedAt }>, count, updatedAt }. Rates are percentages (e.g. 25.5). ' +
      'Use when the user asks for an overview, a comparison across countries, or "all EU VAT rates". ' +
      'For a single country prefer get_country_vat_rates. Data is sourced from the EU Commission TEDB and updated daily. Free, no API key required.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {},
  },
  async () => {
    const rates = EU_COUNTRY_CODES.map((c) => buildRate(c)!).filter(Boolean)
    return ok({ rates, count: rates.length, updatedAt: dataVersion })
  },
)

server.registerTool(
  'get_country_vat_rates',
  {
    title: 'Get VAT rates for a country',
    description:
      'Returns the standard, reduced, super-reduced and parking VAT rates for a single European country, plus the VAT number format and regex. ' +
      'Read-only and offline: no network call, no API key, no rate limit, no side effects. ' +
      'Accepts ISO 3166-1 alpha-2 codes (DE, FR, IT, …); also covers non-EU European jurisdictions where available (NO, CH, GB, UA, TR, …). ' +
      'Output: { countryCode, countryName, vatName, vatAbbr, currency, standardRate, reducedRates[], superReducedRate, parkingRate, vatNumberFormat, vatNumberPattern, updatedAt }; rates are percentages and may be null where not applicable. Returns an error if the country code is unknown. ' +
      'Use when the user asks "what is the VAT rate in X" or needs the VAT number format for a country. Free, no API key required.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      countryCode: z
        .string()
        .length(2)
        .describe('ISO 3166-1 alpha-2 country code, e.g. "DE", "FR", "IT".'),
    },
  },
  async ({ countryCode }) => {
    const rate = buildRate(countryCode.toUpperCase())
    if (!rate) return err(`No VAT data for country code "${countryCode}".`)
    return ok(rate)
  },
)

server.registerTool(
  'check_vat_format',
  {
    title: 'Check VAT number format',
    description:
      'Performs an offline syntactic check of a VAT number against the country-specific regex pattern. ' +
      'Read-only and offline: no network call, no API key, no rate limit, no side effects. ' +
      'Does NOT verify the VAT with VIES (a valid format does not mean the VAT is real or active) — use validate_vat_number for that. ' +
      'Output: { input, normalized, countryCode, validFormat (boolean), error }; countryCode is null when the prefix is unknown. ' +
      'Use when the user wants a quick sanity check on the shape of a VAT ID without burning a quota call. Free, no API key required.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {
      vatId: z
        .string()
        .min(3)
        .describe(
          'A VAT number, with or without spaces/dashes, with or without country prefix (e.g. "DE123456789", "IE 6388047 V").',
        ),
    },
  },
  async ({ vatId }) => {
    const normalized = normalizeVatId(vatId)
    const country = normalized.slice(0, 2)
    const valid = validateFormat(normalized)
    return ok({
      input: vatId,
      normalized,
      countryCode: getRate(country) ? country : null,
      validFormat: valid,
      error: valid ? null : `${normalized} does not match the expected VAT number format for ${country}.`,
    })
  },
)

server.registerTool(
  'list_supported_countries',
  {
    title: 'List supported countries',
    description:
      'Returns every country the vatnode server has VAT data for (EU-27 + XI for Northern Ireland + ~17 other European jurisdictions such as NO, CH, GB, UA, TR). ' +
      'Read-only and offline: no network call, no API key, no rate limit, no side effects. Takes no arguments. ' +
      'Output: { countries: Array<{ countryCode, countryName, isEUMember, viesValidationSupported }>, count, euCount, updatedAt }, sorted by countryCode. ' +
      '`viesValidationSupported: true` means validate_vat_number can do live VIES verification; non-EU jurisdictions are rate-lookup only. ' +
      'Use to discover coverage or to pick a valid countryCode before calling get_country_vat_rates or validate_vat_number.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    inputSchema: {},
  },
  async () => {
    const all = getAllRates()
    const countries = Object.entries(all)
      .map(([code, r]) => ({
        countryCode: code,
        countryName: r.country,
        isEUMember: isVIESEligible(code),
        viesValidationSupported: isVIESEligible(code),
      }))
      .sort((a, b) => a.countryCode.localeCompare(b.countryCode))
    return ok({
      countries,
      count: countries.length,
      euCount: countries.filter((c) => c.isEUMember).length,
      updatedAt: dataVersion,
    })
  },
)

// ---------------------------------------------------------------------------
// Paid tools — require VATNODE_API_KEY
// ---------------------------------------------------------------------------

async function callVatnodeApi(path: string, init?: RequestInit) {
  if (!API_KEY) {
    return {
      ok: false as const,
      error: err(
        'This tool requires a vatnode API key.',
        'Set the VATNODE_API_KEY environment variable in your MCP client config. Get a free key at https://vatnode.dev (free tier includes a monthly request quota).',
      ),
    }
  }
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const code =
      (body as { error?: { code?: string } }).error?.code ?? `HTTP_${res.status}`
    const message =
      (body as { error?: { message?: string } }).error?.message ??
      `vatnode API returned ${res.status}`
    return { ok: false as const, error: err(`${code}: ${message}`) }
  }
  return { ok: true as const, data: body }
}

server.registerTool(
  'validate_vat_number',
  {
    title: 'Validate EU VAT number',
    description:
      'Verifies an EU VAT number against the official VIES service and returns validity, company name, address, registration date and other metadata. ' +
      'When the requester (your own VAT) is configured on the vatnode account, also returns a VIES consultation number — audit-grade proof of validation. ' +
      'Use whenever the user wants to confirm a VAT is real, look up the company behind a VAT, or needs evidence for accounting/compliance. ' +
      'Side effects: makes an authenticated network call to api.vatnode.dev (which queries the EU VIES service) and consumes one request from your monthly quota; it is read-only (verifies, never mutates) and safe to retry. ' +
      'Requires a vatnode API key (free tier available; set VATNODE_API_KEY). Only EU-27 + XI (Northern Ireland) are supported by VIES; other countries return an error.',
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    inputSchema: {
      vatId: z
        .string()
        .min(3)
        .describe(
          'EU VAT number, with country prefix. Spaces and dashes are stripped. Examples: "DE123456789", "IE6388047V", "FR12345678901".',
        ),
      requesterCountryCode: z
        .string()
        .length(2)
        .optional()
        .describe(
          'Optional: 2-letter country code of the party doing the check. Together with requesterVatNumber, asks VIES to issue an audit consultation number.',
        ),
      requesterVatNumber: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Optional: VAT number of the party doing the check. Pair with requesterCountryCode to get a consultation number.',
        ),
    },
  },
  async ({ vatId, requesterCountryCode, requesterVatNumber }) => {
    const normalized = normalizeVatId(vatId)
    const params = new URLSearchParams()
    if (requesterCountryCode && requesterVatNumber) {
      params.set('requesterCountryCode', requesterCountryCode.toUpperCase())
      params.set('requesterVatNumber', requesterVatNumber)
    }
    const qs = params.toString()
    const result = await callVatnodeApi(
      `/v1/vat/${encodeURIComponent(normalized)}${qs ? `?${qs}` : ''}`,
    )
    if (!result.ok) return result.error
    return ok(result.data)
  },
)

// ---------------------------------------------------------------------------

const transport = new StdioServerTransport()
await server.connect(transport)
