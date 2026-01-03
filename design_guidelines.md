# PackPoints Design Guidelines

## Design Approach

**Reference-Based Gaming Platform**
Drawing inspiration from modern card gaming platforms (NBA Top Shot, Sorare) combined with competitive gaming interfaces (Twitch, DraftKings). The design celebrates collecting culture while maintaining the excitement of competitive gameplay.

**Core Principle:** Balance nostalgic collecting aesthetics with modern, high-energy gaming interactions.

---

## Typography

**Font Stack:**
- Primary: Inter (headings, UI elements, scores)
- Secondary: DM Mono (player stats, point values, game timers)

**Hierarchy:**
- Hero/Game Title: 3xl to 5xl, bold
- Card Player Names: 2xl, semibold
- Point Values: xl, mono, medium
- Game Stats: base to lg
- UI Labels: sm, medium

---

## Layout System

**Spacing Units:** Tailwind 4, 6, 8, 12, 16 for consistent rhythm

**Grid Structure:**
- Game Screen: Centered card display (max-w-2xl) with sidebar stats
- Leaderboard: 3-column grid (desktop), single column (mobile)
- Marketplace: 4-column card grid (lg), 2-column (md), 1-column (mobile)

---

## Component Library

### Core Game Components

**Card Reveal Container:**
- Large centered card display with subtle shadow and border
- Blurred player name overlay
- Card dimensions maintain authentic aspect ratio (2.5:3.5)
- Answer options below as prominent pill buttons

**Answer Selection:**
- 2-4 large pill buttons in vertical stack
- Active state: bold border, slight scale
- Correct: green confirmation with point animation
- Incorrect: red flash with shake

**Points Display:**
- Floating badge showing current points (top-right)
- Point value per question prominently shown
- Animated counter for point additions

**Timer/Progress:**
- Clean progress bar for timed games
- Round counter for multi-round matches

### Navigation

**Top Bar:**
- Logo/branding (left)
- Current game mode indicator (center)
- Points balance + profile (right)
- Quick access to: Play, Leaderboard, Marketplace, Profile

### Game Modes Selection

**Mode Cards:**
- 1v Computer: Single prominent card
- 1v1: Dual-player display
- 1vMany: Tournament bracket visual
- Each shows potential point rewards and difficulty

### Leaderboard

**Ranking Display:**
- Top 3: Podium-style with larger cards
- Remaining: Clean table with rank, username, points, win rate
- Personal rank highlighted with accent treatment

### Marketplace Integration

**Redemption Section:**
- Point balance prominently displayed
- Card grid showing available redemptions
- Clear USD/credit conversion rates
- Platform badges (Goldin, eBay)

---

## Images

**Hero Section:**
Include a dynamic hero showcasing iconic baseball cards in a grid or scattered arrangement, with subtle parallax effect. Use high-quality scans of vintage cards (Topps 1987 era) to establish the collecting theme immediately.

**Game Screen:**
Real card imagery from API displayed at large scale (400-500px width minimum) as the centerpiece.

**Background Treatment:**
Subtle textured background suggesting card stock or collecting album pages, never competing with card content.

---

## Animations

**Card Reveal:** Smooth blur-to-clear transition on player name reveal (400ms)
**Point Awards:** Scale + fade animation for point additions
**Answer Feedback:** Instant visual confirmation (no delays)
**Leaderboard Updates:** Smooth position transitions

Keep all animations under 500ms for snappy gameplay feel.

---

## Accessibility

- High contrast for answer options
- Large touch targets (min 44px) for buttons
- Clear focus states for keyboard navigation
- Screen reader announcements for point changes and correct/incorrect answers

---

## Key Design Principles

1. **Card-First:** Trading card always the hero element
2. **Competition Clarity:** Points, rankings, and progress always visible
3. **Nostalgic Modern:** Respect collecting heritage with contemporary gaming polish
4. **Instant Feedback:** No waiting - immediate visual response to every action
5. **Mobile Excellence:** Designed for portrait-mode smartphone play first