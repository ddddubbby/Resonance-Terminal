# Resonance Terminal

Crypto-only narrative intelligence terminal. **Private alpha `v0.1.0-alpha.2`** — see [docs/RELEASE-NOTES.md](docs/RELEASE-NOTES.md) for what the alpha can and cannot do.

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
docs/         Canonical documentation (DESIGN, STATUS, HANDOFF, PROTOCOL)
scripts/      Installer and build tooling
```

## Installation

One command, no API keys:

```bash
./scripts/install.sh
```

The installer checks Node 22 and pnpm 10, installs exact dependencies (`--frozen-lockfile`), and gates the result with `pnpm verify` — the same check CI runs. It is idempotent: safe to re-run after pulling new commits. Installation through a coding agent (Codex or Claude Code) works the same way: point the agent at this repository and ask it to run the installer.

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

## The CLI

```text
resonance scan [--store DIR] [--json]          Fetch, normalize, snapshot, cluster
resonance brief [--store DIR] [--run ID] [--json]
                                               Off-radar movers and confirmed
                                               narratives — the run's output
resonance candidates [--store DIR] [--run ID] [--all] [--components] [--json]
                                               Scored narratives of a grouped run
resonance status [--store DIR] [--json]        Store summary
resonance promote --narrative ID [--note TEXT] [--run ID] [--store DIR]
                                               Promote a narrative to the shortlist
resonance handoff [--store DIR] [--json]       Agent-to-agent handoff document
resonance --help / --version
```

The store defaults to `.resonance`. Scans write immutable snapshots plus run-local artifacts. Grouping and narrative matching are agent-side interpretation steps — see [docs/PROTOCOL.md](docs/PROTOCOL.md) for the six-step scan protocol, and `resonance handoff` for passing the workspace between Codex and Claude without losing state.

`resonance brief` is the output of a run: off-radar movers (assets that moved hard while no narrative mentions them) followed by confirmed narratives (news and price agreeing), then a plain statement of what the run could not measure. Agents are required to present it after every scan — the store is not the deliverable.

## Agents

This repository is developed by AI coding agents alongside a human. All agent instructions live in [`AGENTS.md`](AGENTS.md). `CLAUDE.md` is a pointer to the same guide so Claude Code and Codex receive identical instructions.

## License

[Apache-2.0](LICENSE)
