---
name: DeadIsland
description: Dating for gamers. Find your player 2.
colors:
  void-bg: "#0b0b12"
  lobby-surface: "#151522"
  pulse-pink: "#ff2e88"
  signal-cyan: "#00e5ff"
  aura-violet: "#a855f7"
  haze-muted: "#9a9ab0"
  alarm-red: "#b3261e"
  white: "#ffffff"
typography:
  brand:
    fontFamily: "Orbitron, sans-serif"
    fontWeight: 800
    letterSpacing: "2px"
  display:
    fontFamily: "Orbitron, sans-serif"
    fontSize: "clamp(28px, 6vw, 48px)"
    fontWeight: 800
  section-title:
    fontFamily: "Orbitron, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    letterSpacing: "1px"
  dialog-title:
    fontFamily: "Orbitron, sans-serif"
    fontSize: "24px"
    fontWeight: 700
  page-title:
    fontFamily: "Roboto, sans-serif"
    fontSize: "28px"
    fontWeight: 600
    lineHeight: 1.2
  card-name:
    fontFamily: "Roboto, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.25
  action:
    fontFamily: "Roboto, sans-serif"
    fontSize: "16px"
    fontWeight: 600
  body:
    fontFamily: "Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "20px"
  lead:
    fontFamily: "Roboto, sans-serif"
    fontSize: "18px"
    fontWeight: 400
  tag:
    fontFamily: "Roboto, sans-serif"
    fontSize: "13px"
    fontWeight: 400
  label:
    fontFamily: "Roboto, sans-serif"
    fontSize: "12px"
    fontWeight: 400
    letterSpacing: "0.5px"
  meta:
    fontFamily: "Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 400
rounded:
  tail: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  hero: "48px"
components:
  button-like:
    backgroundColor: "{colors.pulse-pink}"
    textColor: "{colors.void-bg}"
    rounded: "{rounded.pill}"
  card-player:
    backgroundColor: "{colors.lobby-surface}"
    rounded: "{rounded.lg}"
  card-panel:
    backgroundColor: "{colors.lobby-surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
  tag:
    textColor: "{colors.haze-muted}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  tag-common:
    textColor: "{colors.signal-cyan}"
    typography: "{typography.tag}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  badge-liked-me:
    backgroundColor: "{colors.pulse-pink}"
    textColor: "{colors.void-bg}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  badge-match-high:
    textColor: "{colors.pulse-pink}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  chat-bubble:
    backgroundColor: "{colors.void-bg}"
    padding: "8px 12px"
  chat-bubble-mine:
    padding: "8px 12px"
  header:
    backgroundColor: "{colors.lobby-surface}"
    height: "64px"
---

# Design System: DeadIsland

## Overview

**Creative North Star: "The Midnight Lobby"**

DeadIsland is the dark waiting room before a match starts: a near-black hall where the people you have something in common with are lit up in neon. Darkness is the default and light means something. A glowing edge says *this is a person*, a pink pulse says *someone wants you*, a cyan signal says *you share this*. The room is full of glow, but it is never chaotic, because every light belongs to a specific meaning.

The tone is crisp and game-like rather than soft and romantic. Components should feel like a good game UI: responsive, lit on interaction, confident in shape. The romance comes from the content (people, photos, shared games), not from pastel styling. The system is built on Angular Material's dark theme (violet primary, cyan tertiary) with a thin brand layer of `--di-*` variables on top. Material carries the controls, and the brand layer carries the atmosphere.

It must never look like a generic swipe app (white canvas, photo-only swipe, red-orange gradient) or like sterile corporate SaaS (grey dashboards with no character).

**Key Characteristics:**
- Near-black canvas (`void-bg`) with slightly lifted indigo surfaces (`lobby-surface`).
- Three neon voices, each with one job: Pulse Pink = desire/action, Signal Cyan = shared/active, Aura Violet = structure.
- Coloured glow (`box-shadow` in the accent colour) is the house depth effect, used everywhere and scaled by importance.
- Orbitron for the brand voice only. Roboto (via Material) for everything people read.
- Rounded 16px containers, pill-shaped tags, badges and primary buttons.
- Short, purposeful motion: fade-up entrances, cards that fly off on like/skip, bubbles that pop in. All of it collapses under `prefers-reduced-motion`.

## Colors

A dark-neon palette: one near-black field, one lifted surface, three saturated accents, each tied to a meaning.

### Primary
- **Pulse Pink** (`pulse-pink`): the colour of desire and commitment. Used for the Like button, the "likes you" badge, the high-match badge, the notification badge, the "player 2" highlight in the hero, avatar rings, my chat bubbles (at 22% alpha), unread markers, and the borders and glow of match and chat containers.

### Secondary
- **Signal Cyan** (`signal-cyan`): the colour of connection and shared ground. Used for tags you share with another player, the medium-match badge, links, the active nav item, section titles in the profile, feature icons, other people's chat bubble borders (35% alpha), and the chat-preview link.

### Tertiary
- **Aura Violet** (`aura-violet`): the structural glow. Used for the borders (20–40% alpha) and ambient glow of the header, player cards, login and profile panels. It matches Material's violet primary palette, so Material controls (flat buttons, focus states, chips) speak the same colour.

### Neutral
- **Void Black** (`void-bg`): page background, photo/avatar placeholders, other people's chat bubbles. It sits *behind* surfaces and also *inside* them as an inset.
- **Lobby Indigo** (`lobby-surface`): every container: header, cards, panels, chat, state messages.
- **Haze Grey** (`haze-muted`): secondary text: subtitles, city, bio, labels, timestamps, unmatched tags (35% alpha border), placeholder icons.
- **Primary text** comes from Material's `--mat-sys-on-surface` (dark theme); it is not overridden.
- **Hairlines**: `rgba(255,255,255,0.08)` for internal dividers (chat header/composer). `rgba(154,154,176,0.3)` for the login "or" divider.
- **Alarm Red** (`alarm-red`): the offline banner only. Form errors and destructive menu items use Material's `--mat-sys-error`.

### Named Rules
**The One Meaning Rule.** Each neon has one job. Pink is for wanting and acting (like, match, unread, mine). Cyan is for sharing and connecting (common games, links, active). Violet is for structure. Don't paint a shared tag pink or a Like button cyan.

**The Dark-on-Neon Rule.** Text and icons on a solid Pulse Pink or Signal Cyan fill are Void Black (`void-bg`), weight 600 or more, never white. White on Pulse Pink is only 3.5:1 and fails AA for normal-size text; Void Black on it is 5.6:1. This covers the Like button, the "likes you" badge, nav and filter counters, and the match dialog's primary button.

**The Alpha Ladder Rule.** Accents appear as borders and glows at fixed alpha steps. Borders sit at 0.2 (skeleton/quiet), 0.35 (default card) and 0.4 (panels). Glows sit at 0.15–0.25 (ambient) and 0.45–0.6 (call to action). Raise the step with importance; don't invent new alphas.

## Typography

**Brand Font:** Orbitron, then Exo 2 (with sans-serif), weights 600 and 800 from Google Fonts. Orbitron has no Cyrillic, so `--di-brand-font` falls back to Exo 2 for RU/UK letters and Slovak diacritics; Latin text, including the logo, stays Orbitron.
**Body Font:** Roboto (with sans-serif), weights 300/400/500, applied through Material's theme typography.

**Character:** Orbitron is the arcade marquee: wide, geometric, used sparingly for the logo, the hero line and profile section titles. Roboto is the quiet, legible voice for everything a person actually reads, in all four languages.

### Hierarchy
- **Brand** (800, 20px / 16px under 600px, 2px tracking): the "DeadIsland" logo, pink with cyan accent, each with an 8px glow.
- **Display** (Orbitron 800, `clamp(28px, 6vw, 48px)`): the home hero only.
- **Section Title** (Orbitron 600, 15px, 1px tracking, Signal Cyan): profile form sections.
- **Page Title** (Roboto 600, 28px, 1.2): one `h1` per page (the feed's "Players").
- **Card Name** (Roboto 600, 20px, 1.25): player name and age on a card, an `h2`. It wraps anywhere, so long names never push the "⋮" menu off the card.
- **Other headings** (Roboto, browser-default h2/h3 sizes, bold): remaining pages; the chat partner name is 18px.
- **Lead** (Roboto 400, 18px, Haze Grey): hero subtitle.
- **Body** (Roboto 400, 14px/20px; Material `body-medium`): default text, bios (clamped to 3 lines), messages.
- **Tag** (13px): tags, badges, inline errors.
- **Label** (12px, uppercase, 0.5px tracking, Haze Grey): "Games in common", "Contacts" group labels.
- **Meta** (11px, Haze Grey): chat timestamps.

### Named Rules
**The Marquee Rule.** Orbitron is reserved for the brand voice: the logo, the hero, and section titles. Never set body copy, buttons, form fields or anything longer than a short heading in Orbitron. RU/UK/SK text must stay in Roboto.

## Layout

A single centred column: `max-width: 960px`, padding 24px vertical and 16px horizontal, under a sticky 64px header (56px on phones). Focused forms narrow further: login is 400px and the profile form is 720px.

Collections use auto-fill grids that reflow with no fixed breakpoints: player cards `minmax(260px, 1fr)`, matches `minmax(300px, 1fr)`, home features `minmax(220px, 1fr)`, feed filters `minmax(180px, 1fr)`, profile field rows `minmax(240px, 1fr)`. Gaps are 16px between cards and 6–12px inside clusters.

The main hard breakpoint is **600px**. Below it nav labels hide (icons only), the logo shrinks, the chat Enter-hint hides, chat bubbles widen to 85%, and contact "Connect" buttons drop under their field. The feed deck adds a second one at **840px** (see Feed Deck).

Chat is the one full-height surface: `calc(100dvh - 112px)`, with a fixed header and composer and a scrolling message list.

Spacing values in use: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 20 / 24 / 28 / 32 / 48px. The core rhythm is 8–16–24, with 48px for hero padding.

## Elevation & Depth

Depth comes from **light, not shadow**. Surfaces are separated from the void by a lighter indigo plus a thin accent border, and lifted further by a coloured `box-shadow` glow in the container's accent. There are no grey drop shadows. Glow is the house atmosphere and appears on almost every container, and its intensity scales with importance.

### Shadow Vocabulary
- **Ambient aura** (`0 0 16px rgba(168,85,247,0.25)`): the header.
- **Panel aura** (`0 0 24px rgba(168,85,247,0.2)`): login and profile panels.
- **Card hover aura** (`0 0 20px rgba(168,85,247,0.35)`), with a `translateY(-2px)` lift: player card on hover.
- **Pink ambient** (`0 0 16px rgba(255,46,136,0.15)`): match cards, chat container.
- **Pink call** (`0 0 12px rgba(255,46,136,0.45–0.6)`): Like button, "likes you" badge, profile photo ring.
- **High-match glow** (`0 0 10px rgba(255,46,136,0.5)`): 'high' match-percent badge.
- **Text glow** (`text-shadow: 0 0 8–12px <accent>`): logo and hero highlight.
- **Dot glow** (`0 0 8px pulse-pink`): unread dot.
- **Alarm** (`0 4px 12px rgba(179,38,30,0.4)`): offline banner, the only offset shadow.

### Named Rules
**The Glow Scales With Meaning Rule.** Ambient glows stay soft (alpha 0.15–0.25, 16–24px blur). Strong glows (alpha 0.45+) are only for calls to action and signals aimed at the user (Like, "likes you", high match, unread). Loading skeletons have no glow at all.

## Shapes

Firmly rounded, never sharp. Containers use a 16px radius (cards, panels, chat, state messages), secondary blocks 12px (home features, chat-preview link), skeleton bars 8px. Everything small and countable is a **pill** (999px): tags, badges, the Like/Skip buttons (Material's full-corner flat buttons), and skeleton buttons. People are **circles**: avatars 40/64/112px with a 2px Pulse Pink ring.

Chat bubbles are 16px pills with one 4px "tail" corner pointing at the speaker: bottom-left for them, bottom-right for me. Photos in player cards are 3:2 and clipped by the card's radius. Empty and error states use a **dashed** border, the only dashed line in the system, which signals "nothing here yet".

## Components

### Buttons
Crisp and game-like: Material buttons on the violet theme, with the brand Like as the hero action.
- **Shape:** full pill (Material flat/stroked default).
- **Like (primary action):** labelled "Player 2?" in every language (the slogan's verb; screen readers hear "Invite {name} to be your player 2"). Pulse Pink fill, Void Black text at 600 (Dark-on-Neon Rule), pink call glow. It is coloured through Material's tokens (`--mat-button-filled-container-color`, `--mat-button-filled-label-text-color`), not a raw `background`, so Material's hover, focus and disabled states keep working. It sits next to Skip, in the deck's action bar or at the bottom of a grid card.
- **Skip / secondary:** Material stroked button on the violet theme.
- **Icon buttons:** "⋮" moderation menu and chat send (send icon in Pulse Pink).
- **Destructive menu items** (Block): `--mat-sys-error` text and icon.
- **Text link button:** no chrome, Signal Cyan, underlined (login mode switch).

### Chips / Tags
- **Style:** pill, 3px 10px, 13px, 1px border, no fill.
- **Default:** Haze Grey border at 35% alpha, inherited text colour.
- **Common (shared with me):** Signal Cyan border and text. This is the visual proof of a match.
- **Profile pickers** (platforms, genres, play times) use Material chip listboxes on the theme.

### Cards / Containers
- **Corner Style:** 16px.
- **Background:** Lobby Indigo.
- **Border:** 1px accent at an Alpha Ladder step: violet for players, login and profile, pink for matches and chat, cyan at 0.25 for home features.
- **Shadow Strategy:** accent glow (see Elevation).
- **Internal Padding:** 16px for cards, 24px for panels, 20px for features.

### Player Card (signature)
The heart of the feed, read top to bottom in priority order:
- **Photo** (3:2, or a 64px person icon on Void Black) with up to two pill overlays in one wrapping row: **"Likes you"** on the left (pink fill, dark text, glow) and the **match %** pushed right; in a narrow card the % wraps under instead of colliding. The % badge is hidden at 0%; it is a button that toggles a tooltip (also on hover and focus) explaining what the % counts (games weigh most). **Deck on a phone (≤600px):** the photo is capped at 30svh so the name and shared games sit above the sticky buttons; with no photo, the placeholder collapses to the badge row and a 64px circle avatar with a violet ring (40% alpha, structure, not desire) sits beside the name and city. Grid cards and wider screens keep the full 3:2 photo. The feed subtitle is hidden on phones.
- **Name, age** (Card Name type) with the "⋮" menu, then the city.
- **Why you match** directly under the name: common games as cyan tags, then "Shared play times: Evenings · Weekends" and "Shared genres: …" lines with a cyan icon and cyan lead-in.
- **Platforms:** shared ones carry a check icon as well as cyan (never colour alone).
- **Other games:** the first 3, then a dashed "+N more" pill.
- **Bio:** clamped to 3 lines. A "Show more" / "Show less" text button (`aria-expanded`) reveals every game and the full bio.
- **Accessible name:** the article is named by its heading (`aria-labelledby`). Like/Skip/"⋮" labels include the player's name.
- **Grid only:** in a narrow grid card (container under 300px) the Like/Skip icons drop so long labels such as UK "Пропустити" fit. The 2px violet hover lift applies only in the grid and only on `hover: hover` devices.
- **Motion:** on Like the card flies right with a pink glow, on Skip it flies left (0.3–0.35s).

### Feed Deck (signature)
The default "one by one" feed view. A grid view stays available through the toolbar's view toggle, and the choice is remembered.
- **Column:** max 440px, centred. From 840px the column widens to 760px and the deck card splits into two columns: photo on the left (5fr, full card height, min 280px; a silhouette placeholder with the badges on it when there is no photo, and no ring avatar by the name) and details on the right (7fr). The sticky action bar becomes one row: Skip left, Player 2? right, the consent note, keys hint or last-action chip between them, so at 1280×720 the whole card sits above the bar. Grid cards and phones are unchanged.
- **Next player:** peeks from behind the current card, 12px up, scaled 0.94, at 45% opacity, inert and hidden from assistive tech. Only its frame shows: its contents are hidden until it becomes the current card, so badges never poke out above the front card. When the current card flies off, the same element glides forward (0.35s, `cubic-bezier(0.16, 1, 0.3, 1)`).
- **Action bar:** Skip (stroked) and Like (pink), each 48px tall. It is sticky to the bottom of the viewport with a Void Black fade behind it, so it sits under the thumb on phones.
- **Keyboard:** ← skips and → likes (deck only). Z or Backspace undoes the last like or skip in both views, except while typing in a field or list; the Undo button carries `aria-keyshortcuts`. A hint line ("← skip · → player 2 · Z / Backspace undo") appears only on fine-pointer devices.
- **Mis-tap guard:** for 400ms after a swipe, further swipes are ignored, so a double tap can't hit an unseen player.
- **Focus:** moves to the next card's name, or to the page title when the list empties. If the card holding focus (or whose "⋮" menu was opened) disappears on its own, e.g. a block arriving from Firestore before the menu reports it, focus goes to the card that took its place (never back to the first grid card), or to the page title; with a dialog open this waits until it closes.
- **Landmark:** the deck is a region named "Player deck" (not the view-toggle label).
- **Last action chip:** the last action lives in one compact chip (Lobby Indigo, violet 0.4 border, 22px radius, one line with ellipsis) in a reserved row under the deck buttons, replacing the keys hint while it shows. A like reads "♥ Invite: X · Undo · ⏸": the ⏸ icon button (named, with tooltip) holds the 4s timer with no time limit and the chip then reads "Invite on hold: X" with the button becoming "Send now"; the timer's 2px pink bar is the chip's bottom edge (hidden under reduced motion, text stays static). Mouse hover or focus inside the chip also pauses the timer (touch taps never pause). When the time runs out Undo disappears while the write is in flight ("Sending invite: X"), and only after the server confirms does it read "Invite sent: X". Focus never jumps when the timer expires. A skip reads "Skipped: X · Undo". Non-actionable states ("Invite sent", "X is back in the feed") clear themselves after 4s (8s with the consent note); a filter or view change clears the chip unless a like is still pending. A like on someone who already liked you is written at once (like + match in one batch) with no Undo and no invite wording: it opens the Match Dialog (described by its subtitle for screen readers) and the chip then reads "♥ Match: X · Message", linking to the chat. Pending likes are flushed when the feed is left, the tab is hidden or the user logs out. A match produced after the feed is gone shows a snackbar "It's a match: X!" with a "Message" action. The polite live region announces each state change once, never per second. On the first like per account the consent note "Your contacts stay hidden until they like you back." is announced; it shows as a second chip line in the grid and the empty state, while the deck hides it visually because the like-hint just said the same. In the grid the chip floats as a sticky pill and the grid gets bottom padding so the pill never covers card buttons.
- **Toolbar:** a "Filters" stroked button (cyan when active, with a cyan count badge in dark text) controls a collapsible filter panel. Then a polite-live result count (short form "Players: N" under 600px so it stays on one line), then the view toggle (icon plus label, icons only under 600px). Filters button and toggle are 44px tall. The filtered-empty state names the active filters instead of guessing which one is too strict. Filters, panel state and view persist in localStorage.

- **End of feed:** never a dead end. Inside the cyan state message it shows a title and "new players arrive as they sign up". Then comes a left-aligned list, each row only when non-zero: likes waiting for a reply (pink heart), chats with new messages (pink), matches with a "suggest a game for tonight" nudge (cyan gamepad). Counts use the "Label: N" form, so no plural rules are needed in RU/UK/SK. Primary "Go to matches" (pink, dark text) appears when matches exist; stroked "Improve profile" is always there.
- **Profile hint:** a single dismissible row above the deck (cyan 0.35 border, 12px radius) shown while the profile lacks play times or genres. Dismissal is remembered per account.

### Match Card
One card per mutual match on /matches, read top to bottom by priority. Lobby Indigo, pink 0.4 border, pink ambient glow; a flex column whose actions block (`margin-top: auto`) sits at the bottom, so chat rows line up across a grid row and spare height lands in the middle.
- **Header:** 64px avatar with pink ring, name and age (Card Name), city, "⋮" menu. At most one pill beside the name: **"Your turn"** (last message is theirs) in pink fill while unread, as a quiet pink 0.4 outline once read; otherwise **"New match"** (pink fill) for matches since the last visit.
- **What you share:** common games as cyan tags, then "Shared platforms: PC · PlayStation" and "Shared play times: …" lines in the feed's cyan-icon style.
- **Chat row (primary action):** full width, 56px, 12px radius on Void Black, cyan 0.35 border; chat icon, "{speaker}: preview" with ellipsis, and a short timestamp (today "21:40", "yesterday" via `Intl.RelativeTimeFormat`, "12 Oct", or a short date). Unread turns border, icon and time pink, bolds the preview and adds a glowing 8px dot after the time.
- **Contacts:** a wrapping row of 40px pill chips (44px on coarse pointers), cyan 0.35 border, no fill: short platform name ("PSN") plus a cyan icon that says what happens, `content_copy` for a nickname, `open_in_new` for a verified link. The value shows in a tooltip; the accessible name carries action, platform, value and player.
- **Order:** unread first, then latest activity, frozen while the page is open.

### Match Dialog (signature)
"It's a match!" is the feed's one authored moment.
- **Avatars:** two 88px avatars with pink rings slide together, and a cyan gamepad badge pops onto the seam.
- **Text:** the Orbitron pink title rises in, then "{name} is your player 2", then what you can play together: common game tags and a platforms · play times line.
- **Contacts unlocked:** a cyan-bordered row (12px radius, `lock_open` icon) says the two players can now see each other's gaming contacts, with a cyan "See contacts" text button that opens Matches. It rises in last.
- **Buttons:** primary "Send a message" (pink, dark text, focused first) opens the chat; "Keep browsing" closes the dialog. Under 400px they stack full-width, primary on top.
- **Frame:** the dialog draws its own frame (Lobby Indigo, pink 0.4 border, pink ambient glow), so the overlay pane (`.di-match-dialog`) has a transparent Material surface. Under reduced motion it uses fades only.

### Confirm Dialog
The one way to ask "are you sure?" (`shared/confirm-dialog`); the browser `confirm()` is never used.
- **Frame:** same self-drawn frame as the match dialog (`.di-framed-dialog` makes the Material surface transparent), 16px radius, max 400px. The accent is violet, or `--mat-sys-error` for destructive actions (border at 0.4, ambient glow at 0.2).
- **Title:** Roboto 20/600 with an optional icon. It is Roboto, not Orbitron, because it carries a name and a question in four languages.
- **Text:** one line about the consequence, worded for the context. Blocking from the feed never mentions a match or chat.
- **Buttons:** stroked Cancel (focused first; Esc and backdrop also cancel; on top when stacked, matching tab order) and a filled confirm labelled with the action itself, never "OK". The destructive confirm is coloured through Material button tokens. Below 400px the buttons stack.
- Used for unmatch, block, leaving the profile with unsaved edits, and leaving for a platform's sign-in page.

### Inputs / Fields
- **Style:** Angular Material form fields (outline/fill per Material defaults) on the dark violet theme.
- **Errors:** 13px `--mat-sys-error` text under the field or centred above submit.
- **Chat composer:** a Material textarea with a 48px send icon button: pink when there is text, Haze Grey when disabled. The hint is hidden on mobile. Each match keeps its own draft (per account, mirrored to sessionStorage), restored when the chat reopens and cleared on send or sign-out. While offline with messages still pending, a quiet status line above the field says they will send when the connection returns; the pending clock and sent check carry tooltips and accessible names. Nothing is truncated silently: past 800 characters a quiet "N / 1000" counter (tabular numerals) shows at the end of the hint line, turning error colour at 1000; over the limit an alert line explains it and Send is disabled.
- **Notification toasts:** likes, matches and messages from other chats appear at the top, under the header (full width minus 8px on phones, at most 480px on desktop), one line with a pink icon and a "View" action, 6s, paused while hovered or focused, announced politely and never taking focus. They are not shown when the page already says the same thing ("liked you" on the feed, messages on /matches or in that chat), and they queue while a dialog is open. Action results ("Profile saved", "Nick copied") stay as bottom snackbars, lifted above the chat composer, the profile save bar and the feed's action area.
- **Report dialog:** "Also block" starts unchecked, with a muted line saying what blocking removes; ticking it renames the submit button to "Report and block".
- **Profile form order:** gaming profile first (games, platforms, genres, play times), then About you (photo, name, birth date, city, bio), then contacts, so on first run the matching inputs sit in the first viewport. Error summary and focus-first-invalid follow the same order. Signing in or registering without a profile (and without a `returnUrl`) lands on /profile, not on the feed's "fill your profile" blocker.
- **Profile pickers:** under each group label (platforms, genres, play times) a muted 13px line says what the group does for matching, linked by `aria-describedby`; the section hint states only the main rule (shared games count most).
- **Profile error summary:** each field name in "Fix fields (N): …" is an inline underlined button that focuses and scrolls to that field. Ctrl/Cmd+S saves when there are changes (`aria-keyshortcuts` on Save).
- **Profile contacts and photo:** "Connect Steam" sits under its field at every width, so all contact fields share one width. The empty photo placeholder has a violet 0.4 ring and no glow; the pink ring with glow is only for a real photo.
- **Profile action results** on wide screens appear inside the save bar row, left-aligned with the form (`.di-bar-snack`), never over fields; on phones or with unsaved changes they sit above the bar.
- **Profile save bar:** Save is the pink call-to-action with dark text; while saving it dims; with nothing to save it becomes a quiet "✓ All changes saved" (or "Saved on this device" while a write is queued), keeping the bar height. "Save and find players" carries a forward arrow. Only one pink button shows at a time. The unsaved-changes leave dialog is destructive: "Leave" in the error colour, "Stay" focused, and focus returns to where it was after "Stay".

### Navigation
- **Header:** sticky Material toolbar on Lobby Indigo, a 1px violet bottom border at 40%, ambient aura. It has its own `view-transition-name`, so it stays put during page transitions.
- **Logo:** Orbitron brand type, pink + cyan glow.
- **Links:** Material buttons with icon and label. The active link is Signal Cyan. The badge is a Pulse Pink fill with white text. Below 600px only icons show.

### Chat Bubbles
- **Theirs:** Void Black fill, cyan border at 35%, tail bottom-left, left-aligned, max 75% width.
- **Mine:** Pulse Pink at 22% fill, no border, tail bottom-right, right-aligned.
- Both preserve line breaks (`pre-wrap`) and break long words. An 11px timestamp sits right-aligned. A bubble pops in from its tail corner (0.2s).
- **Days and groups:** a centred Haze Grey 12px day separator between hairlines ("Today" / "Yesterday" via `Intl.RelativeTimeFormat`, otherwise "12 October", with the year for past years; `role="separator"`, never announced by the live region). Same-sender messages within 5 minutes on the same day form a group: 2px gap inside, 8px between groups; only the last bubble keeps the 4px tail corner, the rest are fully 16px (a failed bubble always keeps its tail). Bubble width is `min(75%, 60ch)`, `min(85%, 60ch)` on phones.
- **Common-game tags in the chat header and empty state** are inert: cyan 0.5 border, no fill, no hover, default cursor.
- Each bubble carries a visually hidden speaker label ("You:" / "{name}:"). Only incoming messages are announced, through a separate polite live region.
- **Layout:** the chat fills the space between the header (and the offline banner) and the bottom as a flex column, and resizes with the soft keyboard (`interactive-widget=resizes-content`). Below 600px it is full-bleed. On touch screens Enter adds a new line; on desktop Enter sends.
- **Ended:** when the match disappears (unmatch or block by either side), the list freezes and a neutral "This chat has ended" bar with "Back to matches" replaces the composer. It never blames anyone.

### State Message
The shared empty/info/error block: Lobby Indigo, a 1px **dashed** accent border, 16px radius, 40px vertical padding, centred Haze Grey text and a 48px accent icon. Its heading (an `h2`, set globally in `styles.scss`) is 20px/600 in the primary text colour in every state: empty, end of feed, error, 404. The accent is a variable: pink by default, cyan for neutral info, `--mat-sys-error` for errors.

### Skeletons
Shapes match the real content (3:2 photo, text lines at 40–80% width, pill buttons, circle avatars, tailed bubbles) with a white shimmer at 5–12% alpha sweeping every 1.4s. Their containers keep the borders at the quietest alpha step and have no glow.

### Offline Banner
A full-width Alarm Red strip, sticky directly under the header, with white 500-weight text and icon. It slides down to appear and up to leave.

## Do's and Don'ts

### Do:
- **Do** put Void Black text on any solid neon fill (Dark-on-Neon Rule); never white on Pulse Pink.
- **Do** give every page one `h1`, and name repeated cards and buttons after their player.
- **Do** move focus somewhere meaningful when the focused element disappears (after like/skip: the next card's name).
- **Do** keep the canvas Void Black (`#0b0b12`) and put every container on Lobby Indigo (`#151522`) with a 1px accent border.
- **Do** follow the One Meaning Rule: pink = want/act/mine, cyan = shared/linked/active, violet = structure.
- **Do** light containers with an accent-coloured glow, scaled by the Alpha Ladder (borders at 0.2/0.35/0.4, ambient glow at 0.15–0.25, call glow at 0.45–0.6).
- **Do** make countable things pills (999px) and people circles with a 2px Pulse Pink ring.
- **Do** reuse the global motion classes (`di-enter` with `--i` stagger, `di-leave`, `skeleton`) and keep durations at 0.15–0.35s.
- **Do** build skeletons that mirror the real layout, so loading never shifts the page.
- **Do** use Material components and `--mat-sys-*` tokens for controls and error colour; add brand only through `--di-*`. Recolour Material controls through their `--mat-*` component tokens, not raw `background`/`color` overrides.
- **Do** keep Material's strong focus indicators on (2px Signal Cyan, set in `styles.scss`).

### Don't:
- **Don't** make it look like a generic swipe dating app: no white or light canvas, no red-orange gradients, no photo-only full-screen swipe that hides the shared games.
- **Don't** drift into corporate SaaS: no grey-on-grey panels without accent borders, no neutral drop shadows.
- **Don't** set body text, buttons or form fields in Orbitron.
- **Don't** use strong glows (alpha ≥ 0.45) on anything that isn't a call to action or a signal addressed to the user.
- **Don't** add new accent hues; the three neons plus error red are the full set.
- **Don't** ship motion that ignores `prefers-reduced-motion`; the global override must keep working.
