# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Adults (18+) looking for a romantic partner who shares their games. Gaming is the filter, dating is the goal: they want someone who plays the same titles, on the same platform, at the same times of day, so the first date can be a session together.

## Product Purpose

DeadIsland is a dating app for gamers. Users build a gaming profile, browse a feed of players ranked by overlap, like or skip, and on a mutual like unlock each other's contacts and a realtime chat.

It is a **learning project**: built in stages to learn Angular and Firebase, with no real launch planned for now. Design and code should still be production-grade, as if it were shipping.

## Positioning

Matching is built on shared play, not looks or questionnaires. A weighted score (shared games > platforms > genres > play times) sorts the feed, and gaming contacts (Discord, Steam, PSN, Xbox) stay hidden until a like is mutual.

## Operating Context

- Flow: sign up (email/password or Google, 18+ confirmation) → fill gaming profile → feed (filters: game, platform, city, age) → like/skip → match → contacts + chat.
- Notifications for incoming likes, matches and new messages.
- Safety: block, report (fake, spam, offensive, underage, other), unmatch; Firestore rules enforce server-side validation and contact visibility.

## Capabilities and Constraints

- Stack: Angular 22 (standalone, lazy routes, signals), Angular Material + CDK, Firebase Auth + Firestore. Stay on Angular Material rather than replacing the component layer.
- Profile: name, birth date, city, bio, one photo (compressed data URL), games (free text with suggestions), platforms (pc, playstation, xbox, switch, mobile), 12 genres, play times.
- Contacts accept a nickname or an https link to a whitelisted domain only (anti-phishing).
- UI languages: English, Russian, Slovak, Ukrainian (`public/i18n/*.json`). All four are required, and layouts must handle the longer RU/UK strings.
- Code comments are in Russian and explain concepts, since this is a learning codebase.

## Brand Commitments

- Name: **DeadIsland**. Fixed by the owner. It matches the title of the game *Dead Island*, which would need a trademark review before any real launch.
- Core line: "Find your **player 2**" (home hero). Fixed.
- Voice in existing copy: friendly, gamer-casual ("Start the game", "It's a match! 🎉").

## Evidence on Hand

No real users, testimonials, stats or press exist. Do not fabricate member counts, success stories or reviews. There are no brand assets beyond `public/favicon.ico`.

## Product Principles

1. Shared play first: every surface should make the overlap (common games, platforms, times) the visible reason to connect.
2. Mutual consent gates contact: nothing personal is exposed before a mutual like.
3. Safety is always within reach: block/report/unmatch stay one step away wherever another player appears.
4. Adults only, and the product says so plainly.
5. Equal in every language: no surface may assume English string lengths.
