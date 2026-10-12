---
title: Running your own server
description: Settings for people who deploy Ctrl Room.
---

# Running your own server

Ctrl Room is a Next.js app on Supabase (Postgres, Auth and Realtime), with LiveKit for calls. The code's README covers local setup and deployment. These settings are the ones people ask about most.

## Required

| Setting | What it is |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Your Supabase project. |
| `NEXT_PUBLIC_SITE_URL` | Your public address, used in invite links. |

## Voice and video

`NEXT_PUBLIC_LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` from LiveKit Cloud or a self-hosted `livekit-server`. Without them, everything except calls works.

## AI helpers

| Setting | What it is |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Lets the server post the helpers' answers. Keep it secret. |
| `AI_BASE_URL` | Any OpenAI-compatible endpoint: Ollama (`http://localhost:11434/v1`), vLLM, OpenRouter (`https://openrouter.ai/api/v1`) and others. |
| `AI_MODEL` | The model name at that endpoint. Pick one that supports tool calling. |
| `AI_API_KEY` | The endpoint's key, if it needs one. |
| `SEARCH_PROVIDER` | `searxng` (open source, self-hostable) or `brave`. |
| `SEARXNG_URL` / `BRAVE_API_KEY` | Where to search. SearXNG needs its JSON output format turned on. |

Without `AI_BASE_URL` and `AI_MODEL`, the helpers reply that they aren't set up yet. Without a search provider, @ctrl still answers but can't search the web.
