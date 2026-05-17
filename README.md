# 23 Studios

Game development production pipeline for DarkCode LLC. Web app that manages
multiple game projects with AI-driven development via Claude Code and
OpenRouter.

## What is 23 Studios?

A studio shell that wraps:

- **Claude Code CLI** subprocess for AI-driven development per project
- **OpenRouter API** for asset generation and per-task model selection
- **Git CLI** for repo management
- **Per-project build commands** (Phase 3+)

Phase 1 (this release) ships: project registry, file browser, Claude Code
chat, OpenRouter chat alternative. Asset generation, builds, captures, and
brainstorm flow land in Phases 2-6.

## Security Model

23 Studios binds to `127.0.0.1` by default. It is **not** independently
accessible from the internet. Access requires being logged into the host
first (via code-server, SSH tunnel, or an authenticated reverse proxy).

Inside the app, an additional password layer protects every route (defense
in depth). Sessions are `httpOnly + sameSite=strict` cookies with a 24h
TTL. State-changing requests require a CSRF token (double-submit cookie
via `csrf-csrf`). Login attempts are rate-limited (5 / 15 min / IP).

**Do not** change `HOST=127.0.0.1` to `0.0.0.0` without putting the app
behind an authenticated reverse proxy. Direct public exposure is not
supported.

Other protections:

- File browser refuses paths containing `..`, absolute paths outside the
  project root, symlinks pointing outside, files > 1 MB, binary files,
  and a default exclusion list (`.env`, `.git`, `node_modules`, etc.).
- Subprocess calls use `spawn()` with `shell: false`. Arguments are
  arrays. User input is **never** passed as a shell command.
- Helmet sets CSP, X-Content-Type-Options, X-Frame-Options, and friends.
- Errors return generic messages with an error ID; full details are
  logged server-side only.

## Prerequisites

- Node.js 20+
- Claude Code CLI installed and authenticated (`claude login` already run)
- OpenRouter API key
- Git
- Access to the server via code-server, SSH, or local console

## Setup

```bash
cd /home/hakcer/projects/23studios
npm install
npm run install:all
cp .env.example .env
# Edit .env:
#   SESSION_SECRET     openssl rand -hex 32
#   STUDIO_PASSWORD    your choice
#   OPENROUTER_API_KEY from openrouter.ai
#   CLAUDE_CODE_BIN    'claude' (default) or path to your claude binary
npm run build
npm start
```

## Access

Open `http://127.0.0.1:8090` from the server's browser. From a remote
machine, tunnel:

```bash
ssh -L 8090:127.0.0.1:8090 user@server
# Then visit http://127.0.0.1:8090 from local browser
```

Or use code-server's port forwarding so the request flows through
code-server's auth.

Log in with the password from `.env`.

## Developing

```bash
npm run dev
# server on 127.0.0.1:8090
# vite on 127.0.0.1:5173 with /api and /ws proxied to the server
```

## Adding a project

Via UI: Dashboard → "+ New Project" → fill form.

Via API:

```bash
curl -X POST http://127.0.0.1:8090/api/projects \
  -H "Content-Type: application/json" \
  -H "x-csrf-token: $TOKEN" \
  --cookie-jar j --cookie j \
  -d '{ "id": "myproj", "name": "...", "repo": "...", "local_path": "...", "platform": "playdate" }'
```

Validation: `id` is alphanumeric + hyphens (≤ 64), `local_path` must
exist on disk and be a git repo, `repo` must match the git URL pattern,
build/preflight commands restricted to safe characters.

## Layout

```
server/         Node.js + Express backend (auth, registry, files,
                Claude Code subprocess, OpenRouter, WebSocket chat)
ui/             React + Vite + Tailwind frontend
.env.example    Required env vars
```

## Roadmap

- **Phase 1 (this release):** Skeleton, file browser, chat
- Phase 2: Brainstorm → design doc workflow
- Phase 3: Build pipeline + log streaming
- Phase 4: Asset generation via OpenRouter
- Phase 5: Capture / recording viewer
- Phase 6: Multi-platform build support

## License

MIT. See [LICENSE](LICENSE).
