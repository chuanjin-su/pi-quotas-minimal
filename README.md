# pi-quotas-minimal

Quota status extension for [pi](https://github.com/earendil-works/pi-mono/tree/main/packages/coding-agent) that shows remaining usage for subscription/API providers, in the style of [pi-codex-usage](https://github.com/calesennett/pi-codex-usage).

Supported providers:

| Provider | Shown as | Data source |
| --- | --- | --- |
| OpenAI Codex (`openai-codex`) | `Codex` | `https://chatgpt.com/backend-api/wham/usage` (5h / 7d windows) |
| OpenCode Go (`opencode-go`) | `OpenCode Go` | `https://opencode.ai/zen/go/v1/usage` (5h / week / month windows) |
| DeepSeek (`deepseek`) | `DeepSeek` | `https://api.deepseek.com/user/balance` (prepaid balance) |

The status line appears automatically when the active model belongs to a supported provider. For unsupported providers nothing is shown.

## Install

```bash
pi install npm:pi-quotas-minimal
```

## Status line

Footer examples (percentages colored green/yellow/red by how much is left):

```
Codex 5h:(2h10m) 81% left 7d:(5d0h) 64% left
OpenCode Go 5h:(1h0m) 61% left week:(5d0h) 85% left month:(1d0h) 0% left
DeepSeek $110.00 ¥88.50
```

- `compact` format shortens countdowns and drops the `left`/`used` suffix.
- DeepSeek ignores the format setting (always 2-decimal balances).
- Missing credentials → nothing is shown; a failed request → `<Provider> unavailable`.

## Commands

| Command | Effect |
| --- | --- |
| `/quotas` | Open the settings menu. |

Menu items:

- **Show all sources** — opens a framed popup panel (`Provider Quotas`) with a progress bar per window for every signed-in supported provider, `r` refreshes, `q`/`Esc` closes.
- **Status** — show/hide the footer status for the current session (not persisted).
- **Mode** — `left` ↔ `used` percentages.
- **Format** — `compact` ↔ `full`.

## Settings

Stored in `~/.pi/agent/quotas.json` (or `$PI_CODING_AGENT_DIR/quotas.json`):

```json
{
  "usageMode": "left",
  "format": "full"
}
```

Credentials are read from pi's own auth:

- Codex: OAuth entry in `~/.pi/agent/auth.json` (created by `/login`)
- OpenCode Go: `OPENCODE_API_KEY` env var or `auth.json["opencode-go"]`
- DeepSeek: `DEEPSEEK_API_KEY` env var or `auth.json["deepseek"]`

## Development

```bash
npm install
npx tsc --noEmit --strict ... extensions/quotas-status.ts src/*.ts
pi -e ./extensions/quotas-status.ts   # quick test
```

## License

MIT
