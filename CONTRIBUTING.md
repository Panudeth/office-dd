# Contributing

Thanks for your interest. Issues and pull requests are welcome.

## Before you start

- For anything bigger than a small fix, open an issue first so we can agree on the direction — the project has strong opinions about staying simple (no workflow builder, no heavy dependencies).
- One PR = one change. Small PRs get reviewed fast.

## Dev setup

```bash
npm install
npm run dev        # http://localhost:3210 - runs without any keys (demo mode)
npm run typecheck  # must pass
npm run build      # must pass
```

Supabase-dependent features (auth, webhooks, MCP, LINE) need a Supabase project + `supabase/schema.sql` — see README. Everything else works without it.

## Ground rules

- TypeScript strict; no new dependencies without a strong reason.
- UI text goes through `t('ไทย')` from `src/lib/i18n.ts` with the English string added to `src/i18n/en/` — Thai is the source key, English the translation. New user-visible text must have both.
- Comments in the codebase are in Thai and explain "why", not "what" — keep that style (English comments are fine for new code).
- Schema changes go into `supabase/schema.sql` and must be idempotent (`if not exists` / `drop ... if exists` first), so existing users can re-run the whole file to migrate.
- Never commit secrets. `.env` is gitignored; keep it that way.

## Reporting security issues

Please do not open a public issue for vulnerabilities (token handling, webhook auth, RLS bypass, prompt injection with real impact). Email panudeth.jar@gmail.com instead.
