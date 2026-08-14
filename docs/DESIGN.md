# 🎨 UI/UX Design System Specification — RedeemRelay

## 1. Design Philosophy
RedeemRelay utilizes a **Modern Dark Glassmorphism** design system focused on high scannability, rich contrast, dynamic feedback, and responsive adaptability across desktop and mobile devices.

---

## 2. Color Palette & Design Tokens

### 2.1 Core Base Colors
| Token | Hex / Value | Usage |
| :--- | :--- | :--- |
| `--bg-base` | `#0a0a0f` | Main page background |
| `--bg-card` | `#111118` | Card and panel surfaces |
| `--bg-card-hover` | `#16161f` | Hover state for card surfaces |
| `--bg-sidebar` | `#0d0d14` | Sidebar navigation background |
| `--border` | `rgba(255, 255, 255, 0.06)` | Subtle panel and divider borders |
| `--border-accent` | `rgba(129, 140, 248, 0.35)`| Focus rings & active card highlights |

### 2.2 Functional Accent Colors
| Token | Hex | Role |
| :--- | :--- | :--- |
| `--primary` | `#818CF8` (Indigo) | Primary buttons, active tabs, brand icons |
| `--success` | `#34D399` (Emerald) | Active status, healthy sources, success toasts |
| `--warning` | `#FBBF24` (Amber) | Unconfirmed status, backoff warnings, info toasts |
| `--danger` | `#F87171` (Rose) | Expired codes, error logs, deletion actions |
| `--purple` | `#C084FC` (Purple) | Anniversary types, special badges |

### 2.3 Game Accent Badges & Pills
- **Honkai: Star Rail (`hsr`)**: `#818CF8` (Indigo) — `✨ Star Rail`
- **Genshin Impact (`genshin`)**: `#FB923C` (Orange) — `⚔️ Genshin`
- **Wuthering Waves (`wuwa`)**: `#2DD4BF` (Teal) — `🌀 WuWa`
- **Arknights: Endfield (`endfield`)**: `#F87171` (Red) — `🛡️ Endfield`
- **Neverness to Everness (`nte`)**: `#C084FC` (Purple) — `🌆 NTE`

---

## 3. Typography
- **Primary UI Font**: `Inter`, sans-serif (Google Fonts)
- **Monospace Font**: `JetBrains Mono`, monospace (used for redeem codes, API docs, logs, and timestamp data)

---

## 4. Component Library Architecture

### 4.1 Library Integration
- **Framework**: DaisyUI v4 (CDN) + Tailwind CSS (CDN)
- **Theme**: Modified `data-theme="night"` with custom CSS variable overrides in `public/style.css`.

### 4.2 Key Interactive Components

#### Collapsible Sidebar
- **Expanded Width**: `240px`
- **Collapsed Width**: `64px` (Icon-only mode with tooltips and badge counters)
- **Mobile Mode**: Converts into a slide-over overlay drawer triggered by hamburger menu (`#mobileToggleBtn`).

#### Stat Overview Cards (`.stat-card`)
- 4 grid cards: Total Codes, Active Work Codes, Healthy Web Sources, Active Discord Webhooks.
- Glassmorphism effect with subtle gradient background and hover lift animation (`transform: translateY(-3px)`).

#### Live Feed Table & Filter Pills
- Sticky `<thead>` header with column sorting indicators (`↕`) and locking mechanism during sorting fetch.
- Skeleton shimmer animation (`.skeleton-bar`) during data fetching.
- Game filter pills and status filter pills with pill active state and glow.
- **Click-to-Copy Code Chips (`.code-clickable`)**:
  - Interactive chip with hover glow, cursor pointer, and instant copy trigger `copyToClipboard(code)` on click.
  - Eliminates small icon buttons for enhanced mobile accessibility.

#### Quick Push & Force Broadcast Structured Grid
- **Unified 3-Column Grid (`.form-grid-push`)**:
  - `[Field 1 (1fr)] [Field 2 (1fr)] [Action Button (110px)]`.
  - Uppercase sub-labels (`.field-label`) for consistent vertical rhythm and pixel-perfect symmetry.
  - Fixed-height action buttons (`.btn-block`, `36px`) aligned to baseline.

#### Webhook Accordion Cards (`.webhook-card-item`)
- Expandable / collapsible cards with smooth CSS transition on `max-height`.
- **Top-Right Switch Toggle**: Direct enable/disable switch on card header accessible without opening the collapse.
- Compact padding (`12px 16px`) and tight field spacing (`gap-8`) eliminating dead space.
- Right-aligned action footer buttons (`Test Payload`, `Delete`, `Save Webhook`).

#### Toast & Progress Bar
- Toast messages slide in from bottom-right (`#toastContainer`) with color-coded left borders.
- Global top progress bar (`#globalProgressBar`) with animated linear gradient sweep during API requests.
