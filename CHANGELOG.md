# Changelog

## 1.0.0 - 2026-08-20

First release.

- Pixel-art office where every employee is an AI agent: hire departments, ask questions, watch meetings, get reports
- Departments: 6 presets + create your own (AI drafts the skill), per-department skills, playbooks, notes, and knowledge (pgvector)
- Model support: Claude, Gemini, OpenAI-compatible (Ollama, LM Studio, Groq, ...), per-employee model assignment, office "local models only" policy
- Ways in: web chat, customer chat via LINE Official Account, other agents via MCP, systems via per-department inbound webhooks (a courier delivers the document by motorbike)
- Ways out: per-department channels to Teams, Slack, Discord, LINE, or any webhook, with per-source routing
- Persistence with Supabase (auth, offices, staff, meetings, documents, realtime) - optional, runs without it
- Office editor (move everything, Stardew style), custom department signs, bilingual UI (English/Thai) with agents replying in either language
- Deploy: npm, Docker (`ghcr.io/panudeth/office-dd`), or Vercel; example GCP billing-to-finance pipeline in `examples/gcp-billing/`
