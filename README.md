# vatnode-mcp

[![npm version](https://img.shields.io/npm/v/vatnode-mcp)](https://www.npmjs.com/package/vatnode-mcp)
[![Tests](https://github.com/vatnode/vatnode-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/vatnode/vatnode-mcp/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![vatnode/vatnode-mcp MCP server](https://glama.ai/mcp/servers/vatnode/vatnode-mcp/badges/score.svg)](https://glama.ai/mcp/servers/vatnode/vatnode-mcp)

Official [Model Context Protocol](https://modelcontextprotocol.io) server for **[vatnode](https://vatnode.dev)** — VAT validation and EU tax data for AI agents.

Lets AI assistants (Claude Desktop, Cursor, ChatGPT, Continue, Cline, …) look up VAT rates, check VAT number formats, and validate VAT IDs against the EU VIES service without leaving the chat.

- **Free, offline** — VAT rates and format checks for 45 European countries, no account needed
- **Live validation** — verify EU VAT numbers against VIES, get the registered company + audit-grade consultation number (requires a free [vatnode](https://vatnode.dev) API key)
- **Five focused tools** — well-described for accurate agent tool selection
- Pure stdio, zero hosted dependencies, runs locally via `npx`

---

## Tools

| Tool | Free | Description |
|---|---|---|
| `get_country_vat_rates` | ✅ | Standard / reduced / super-reduced / parking rates + VAT number format for a country |
| `list_eu_vat_rates` | ✅ | All 27 EU member states (plus XI for Northern Ireland) at once |
| `check_vat_format` | ✅ | Offline syntactic check of a VAT number against the country regex |
| `list_supported_countries` | ✅ | All 45 supported countries and which ones support full VIES validation |
| `validate_vat_number` | 🔑 | Live VIES validation — returns validity, company name, address, registration date, and optional consultation number for audit proof |

Free tools work fully offline — data is bundled via [`eu-vat-rates-data`](https://www.npmjs.com/package/eu-vat-rates-data) and updated daily from the European Commission TEDB.

`validate_vat_number` requires a vatnode API key. The free tier includes a monthly request quota — [get one in 30 seconds](https://vatnode.dev).

---

## Install

### Claude Desktop

Add to your `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "vatnode": {
      "command": "npx",
      "args": ["-y", "vatnode-mcp"],
      "env": {
        "VATNODE_API_KEY": "vat_live_..."
      }
    }
  }
}
```

Restart Claude Desktop. The `vatnode` tools will appear in the tool picker.

You can omit `VATNODE_API_KEY` if you only need the free tools (rates, format checks).

### Cursor

Settings → MCP → Add new server:

```json
{
  "mcpServers": {
    "vatnode": {
      "command": "npx",
      "args": ["-y", "vatnode-mcp"],
      "env": { "VATNODE_API_KEY": "vat_live_..." }
    }
  }
}
```

### ChatGPT (custom connectors / Apps SDK)

Configure as an stdio MCP server with the same `npx -y vatnode-mcp` command. See the [Apps SDK docs](https://platform.openai.com/docs).

### Continue / Cline / other clients

Any MCP-compatible client can connect — point it at `npx -y vatnode-mcp` and (optionally) pass `VATNODE_API_KEY` via environment.

---

## Get an API key

`validate_vat_number` requires a [vatnode](https://vatnode.dev) account. The platform also offers things the MCP doesn't expose:

- Webhooks for VAT status changes (monitor a customer's VAT continuously)
- Bulk validation
- National-database fallback when VIES is down
- VIES consultation numbers (audit-grade proof of validation)
- Per-key rate limiting + dashboard analytics

[**Sign up free →**](https://vatnode.dev)

---

## Example session

> **You:** What's the VAT rate in Finland and Germany?
>
> *(Agent calls `get_country_vat_rates` for FI and DE — free, no key.)*
>
> **Agent:** Finland's standard VAT is 25.5%, Germany's is 19%. Finland has reduced rates of 14% and 10%; Germany has 7%.

> **You:** Is IE6388047V a valid VAT?
>
> *(Agent calls `validate_vat_number` — requires API key.)*
>
> **Agent:** Yes, it's valid. Registered to **GOOGLE IRELAND LIMITED** at Gordon House, Barrow Street, Dublin 4.

---

## Configuration

| Env var | Required | Default | Purpose |
|---|---|---|---|
| `VATNODE_API_KEY` | for `validate_vat_number` | — | API key from https://vatnode.dev |
| `VATNODE_API_URL` | no | `https://api.vatnode.dev` | Override the API base (self-hosting / staging) |

---

## Contributing

Bug reports and PRs welcome. Open an issue first for non-trivial changes so we can align on direction.

```bash
git clone https://github.com/vatnode/vatnode-mcp.git
cd vatnode-mcp
npm install
npm test
```

## Releasing

Releases are published to npm via [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) — no NPM_TOKEN secret, every release signed with [npm provenance](https://docs.npmjs.com/generating-provenance-statements).

```bash
# bump version in package.json (and VERSION in src/index.ts), commit, then:
git tag v0.2.1
git push --tags
```

CI on `.github/workflows/release.yml` picks up the tag and publishes.

## License

MIT

