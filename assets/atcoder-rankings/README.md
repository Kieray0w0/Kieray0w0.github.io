# AtCoder Ranking Assets

These PNGs reproduce the flags and crown images referenced by the official
Algorithm / Active Users ranking, not inferred podium or contest-winner badges.

Official ranking source:
https://atcoder.jp/ranking?contestType=algo&lang=en

Official asset URL templates (CODE is two uppercase letters; TYPE is champion,
gold, silver, or bronze):

- https://img.atcoder.jp/assets/flag/CODE.png
- https://img.atcoder.jp/assets/icon/crown_TYPE.png

The initial source inspection on 2026-09-28 identified seven flags (BY, CN, CA,
US, JP, KR, PL) and two crowns (champion, gold) for the top ten. Each original
PNG has a 16 x 16 canvas. The champion image belongs to tourist in that snapshot;
all other top-ten rows reference the gold image. Name colors are separate data.

`update_rankings.cache_atcoder_assets` caches required files under `flag/` and
`icon/` before publishing new AtCoder rows. Valid existing files are reused.
Future snapshots may require additional official country or crown files.
Keep this README with all required PNGs in any public/offline asset export.

## Rights

No explicit redistribution license for these flag or crown PNGs was identified
in the inspected official sources. Their availability at public URLs is not a
license grant. No claim of public-domain, MIT, or other permissive licensing is
made here. AtCoder's Terms of Use state that rights in service text, images,
programs, and other data belong to AtCoder or the relevant third-party rights
holder. Confirm permission for the intended redistribution before publishing.

Official terms: https://atcoder.jp/tos?lang=en
