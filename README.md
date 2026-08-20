# OfficeDD

A pixel-art company run by AI agents.

You hire departments, give them skills, and hand them work. They hold meetings, consult each other, and report back — and you watch it happen in a small office rendered in the browser. Work comes in from you, from customers (LINE), from other agents (MCP), or from your systems (webhooks), and results go out to Teams, Slack, Discord, LINE, or any webhook.

It is not a workflow builder. There is nothing to wire. You hire a department and it decides what to do with what it receives.

Thai documentation (full detail): [README.th.md](README.th.md)

<!-- screenshot / gif here -->

## Quick start

```bash
git clone https://github.com/onedd-digital/OfficeDD.git
cd OfficeDD
npm install
npm run dev
```

Open http://localhost:3210, click the key button in the top bar, and paste a Claude or Gemini key (or point it at a local Ollama). Without a key it still runs in demo mode — full animation, placeholder answers.

That is enough to play. No database needed — but nothing is saved between refreshes. To keep your office, staff, and documents, set up the database (5 minutes, free): see [Database](#database-optional).

## Optional pieces

| Want | Needs |
|---|---|
| Sign in, keep your office and staff between sessions | Supabase project + `supabase/schema.sql` (free tier is fine) |
| Let other agents ask your departments (MCP) | Supabase + `SUPABASE_SECRET_KEY`, then create a token in the app |
| Customers message a department via LINE | Supabase + a LINE Official Account (set up in the app, no env needed) |
| Systems post data to a department (webhooks) | Supabase, then create an inbox token in the app |
| Departments post reports to Teams / Slack / Discord / LINE / webhook | Add a channel in the department's **Outbound** tab |
| Run models locally | Ollama on the same machine; pick it in the key panel or set `OPENAI_BASE_URL=http://localhost:11434/v1` |

Copy `.env.example` to `.env` and fill in only what you use. Each variable is documented there.

## Database (optional)

Everything persistent runs on Supabase (free tier is enough):

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), and run it. The file is idempotent — when the schema changes in a later version, run it again to migrate.
3. In **Project Settings → API keys**, copy two values into `.env`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

4. Restart the dev server, sign in, and create your office.

For webhooks, MCP, and LINE the server also needs the secret key (never expose it to the browser):

```env
SUPABASE_SECRET_KEY=sb_secret_...
```

## How it works

- **Departments** — built-in (PR, Finance, Engineering, Legal, Marketing, People) or create your own; each has a name, a role, a skill text, and a playbook. The AI drafts the skill for a new department; you edit it.
- **Staff** — each hire is an agent with a persona and a model. Different staff can run on different models.
- **Questions** — a question goes to the owning department; it answers directly or calls other departments into a meeting. Every step is animated because the animation is driven by the actual events.
- **Knowledge** — documents sent to a department are embedded and become part of what it knows (`pgvector`).
- **Inbound** — `POST /api/office/inbox/<deptId>` with a bearer token. The department reads the data, writes a note or does the task, and posts the result to its outbound channels. A courier rides in on a motorbike to deliver it; that part is just for fun.
- **Outbound** — per-department channels with routing by source, so GCP billing can go to the finance Teams channel while bug reports go to the IT Slack channel.
- **Local-only policy** — an office can be pinned to local models so nothing leaves the machine.

Examples: [`examples/inbox-example.mjs`](examples/inbox-example.mjs), [`examples/gcp-billing/`](examples/gcp-billing/) (daily GCP cost per project and service → finance department → Teams).

## Stack

Next.js 15 (App Router), React 19, Tailwind, Radix, Supabase (Postgres, RLS, Realtime, pgvector), Anthropic / Google / OpenAI-compatible SDKs, Model Context Protocol.

## Status

Early. Used daily by its author; APIs and schema may still change. Issues and PRs welcome.

## License

MIT — see [LICENSE](LICENSE).
