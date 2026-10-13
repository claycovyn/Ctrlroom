---
title: AI helpers (@ctrl and @openctrl)
description: Ask questions, do research, or get help with OpenCtrl apps right in the chat.
---

# AI helpers: @ctrl and @openctrl

Ctrl Room has two built-in helpers you can mention in any room, just like a person.

## @ctrl: questions and research

Mention **@ctrl** with a question. It can:

- Answer general questions and explain things.
- **Search the web** and **read pages** to research a topic, then list the sources it used.
- Use what was said in the room or thread for context ("@ctrl summarize this thread").

## @openctrl: help with OpenCtrl apps

Mention **@openctrl** with a question about Ctrl Room or another OpenCtrl app ("@openctrl how do I make someone a mod?"). It answers from these docs and links to the page it used. If the docs don't cover it, it says so instead of guessing.

## How answers show up

- The answer is posted **in a thread** under your message, so the room stays readable. If you asked inside a thread, it answers in that thread.
- While it works, the room shows what it's doing: thinking, searching the web, reading a page.
- You get a ping when the answer arrives, like any reply.
- Ask a follow-up by replying in the same thread: once it has answered you there, you don't need to mention it again. (Mention someone else and it stays out of it.) Adding @ctrl to a message by editing it works too.

## Limits

- Each person can ask **20 times an hour** in each community, and each community gets **300 answers a day**. Past that, the helper replies that the limit was reached.
- On OpenCtrl Cloud's Free tier, the communities someone owns share **100 AI answers a month**; OpenCtrl Cloud subscribers get far more. A self-hosted Ctrl Room has no monthly limit.
- Answers can be wrong. Check anything important, and follow the sources.

## What the helper sees

To answer, Ctrl Room sends the AI model your message, the recent messages in that room or thread, and any web pages the helper reads. It doesn't see other rooms, other communities, or private settings. The helper can't post anywhere except the thread you asked in, and it can't change anything in your community.

The model is whichever one the server is configured with. Ctrl Room works with open-source models (for example Llama or Qwen, through Ollama, vLLM or OpenRouter).
