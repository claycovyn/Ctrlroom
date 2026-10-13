# Licensing

Ctrl Room is an OpenCtrl Original, licensed under the **GNU Affero General Public License v3.0 only**
(`AGPL-3.0-only`), the license OpenCtrl chose for every Original (build plan decision 1, approved by counsel,
2026-10-12). Copyright Clayton Sinclair.

> This page explains the license in plain words; it isn't legal advice, and the [LICENSE](../LICENSE) file is what
> counts.

## Why AGPL-3.0

Ctrl Room is free to use and self-host, and OpenCtrl Cloud offers a hosted version as a paid service. The AGPL keeps
it free for everyone while asking one thing of people who run a **modified** version for others over a network: offer
those users the modified source (section 13). `-only` (not `-or-later`) so future license versions are a decision for
the copyright holder.

## What it means for you

| You… | What the AGPL asks |
| --- | --- |
| Use a hosted Ctrl Room | Nothing. |
| Self-host Ctrl Room unchanged, for yourself, your community or your company | Nothing beyond keeping the license notice. |
| Change Ctrl Room and use it only inside your organisation | Nothing to publish. |
| Change Ctrl Room and let other people use it over the network | Offer those users your changed source code, under the AGPL. Set `CTRLROOM_SOURCE_URL` to your fork so `/source` and the footer link to it. |
| Talk to Ctrl Room's database API or LiveKit rooms from your own app | Nothing: talking to it over the network doesn't put your app under the AGPL. |

## What stays MIT

- `src/lib/mcp-kit/`: vendored from `@openctrl/mcp-kit`, MIT (see its `LICENSE`), so any app can adopt it.

## Dependencies

All production dependencies are compatible with AGPL-3.0 (checked 2026-10-12): MIT, ISC, Apache-2.0, BSD-3-Clause,
0BSD; LGPL-3.0-or-later (`sharp`'s libvips binaries, optional, used by Next.js image handling); CC-BY-4.0
(`caniuse-lite` browser data, build time). Re-check when adding a dependency; avoid licenses that conflict with the AGPL (for
example SSPL, BUSL, or "non-commercial" terms).

## Contributions

Outside contributions are accepted under the [Contributor License Agreement](CLA.md), so the project can keep choosing
its license.

## Copyright holder

Clayton Sinclair (GitHub: claycovyn), sole author of every commit to date.
