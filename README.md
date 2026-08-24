# Resonance Terminal

Crypto-only narrative intelligence terminal. Currently a **private alpha** under public construction toward the `v0.1.0-alpha.1` milestone.

The milestone proves one complete loop:

1. Local installation without API keys (through Codex or Claude Code).
2. Five fixed public-data connectors (Binance, Coinbase, DefiLlama, RSS/Atom, GitHub).
3. Immutable snapshots of collected documents.
4. Ten evidence-backed narrative candidates produced from real data.
5. At least three scans across seven days.
6. Change reporting and attention-derived metrics from accumulated observations.
7. Full or explicitly labeled partial scores.
8. Workspace handoff between Codex and Claude without losing state.

**Not in scope for the private alpha:** equities, commodities, WorkBuddy, X integration, scheduling, a database, local embeddings, MCP, trading, or a browser UI.

See [docs/DESIGN.md](docs/DESIGN.md) for the approved direction and branch sequence, and [docs/STATUS.md](docs/STATUS.md) for current merged behavior.

## Repository layout

```
packages/lib  Shared contracts and core logic (@resonance/lib)
packages/cli  The `resonance` command line interface (@resonance/terminal)
docs/         Canonical documentation (DESIGN, STATUS, HANDOFF)
```

## Requirements

- Node 22 (pinned in [`.nvmrc`](.nvmrc))
- pnpm 10 (pinned via `packageManager` in [`package.json`](package.json))

## Development

```bash
pnpm install --frozen-lockfile
pnpm verify
```

`pnpm verify` runs formatting/lint checks (Biome), builds both packages, type checks (tsc), runs the Vitest suite, and executes the packed-CLI smoke check in a temporary directory.

### Useful scripts

| Command | Purpose |
| --- | --- |
| `pnpm verify` | Everything CI runs |
| `pnpm lint` | Biome lint and format check |
| `pnpm format` | Apply Biome formatting and safe fixes |
| `pnpm typecheck` | TypeScript checks (sources and tests) |
| `pnpm build` | Build all packages into `dist/` |
| `pnpm test` | Run the Vitest suite |

## Current CLI state

The CLI is a placeholder:

```text
resonance --help      Show help (also the default with no arguments)
resonance --version   Show the CLI version
```

Real commands (`init`, `scan`, `candidates`, `promote`, `narrative`, `investigate`, `status`, `handoff`, `verify`) arrive in later milestone branches.

## Agents

This repository is developed by AI coding agents alongside a human. All agent instructions live in [`AGENTS.md`](AGENTS.md). `CLAUDE.md` is a pointer to the same guide so Claude Code and Codex receive identical instructions.

## License

[Apache-2.0](LICENSE)
