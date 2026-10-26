# Attendance Manager Design System

## Direction: Margin Club

Attendance Manager should feel like a student's own working notebook: exact, candid, and practical rather than institutional or corporate. The interface combines familiar controls with a paper-and-ink visual language so attendance calculations remain trustworthy while the product has a distinct identity.

### Principles

1. **Show the margin, not just the percentage.** The student's actionable per-subject hour budget is the primary result.
2. **Calculation is not permission.** Leave-planning surfaces must preserve this distinction in their copy.
3. **Unknown is never optimistic.** Missing attendance or timetable data blocks recommendations and is visibly labeled.
4. **Personality supports comprehension.** Marker lines, target ticks, notebook rules, and short Fraunces notes may add character; they must not replace standard labels or controls.
5. **Mobile is a primary context.** A student should be able to read every subject outcome between classes without horizontal scrolling.

## Visual Language

- Warm paper background with a very subtle cobalt notebook grid.
- Cobalt structures the interface and carries primary actions.
- Butter highlights settings, summaries, and decisions.
- Tangerine marks thresholds, active navigation, and risk.
- Black rules and borders make controls and groups explicit.
- Corners are modestly rounded; avoid pill-shaped containers except true progress tracks.
- Shadows are restrained and slightly physical, like paper placed on a desk.
- Avoid gradients except the intentional one-pixel notebook grid treatment.

## Color Tokens

| Token | Value | Use |
|---|---:|---|
| `--paper` | `#fffdf6` | Page and light surface |
| `--paper-deep` | `#f7f2e4` | Secondary paper and subtle depth |
| `--white` | `#ffffff` | Input and card surfaces |
| `--ink` | `#171713` | Primary text, borders, focus ring |
| `--muted` | `#625e54` | Supporting text |
| `--line` | `#d9d1bf` | Dividers |
| `--cobalt` | `#1746d1` | Primary action and structure |
| `--cobalt-dark` | `#0d2d90` | Strong link and hover state |
| `--butter` | `#f6d968` | Highlight and summary surfaces |
| `--tangerine` | `#f05a24` | Target marks and emphasis |
| `--tangerine-dark` | `#ad3510` | Accessible annotation text |
| `--green` | `#287548` | Positive connection/status dot |
| `--danger` | `#b83222` | Blocking and below-target state |
| `--danger-surface` | `#fff0e9` | Error background |

Placeholder text uses `#6f695e` to remain above WCAG AA contrast on white and paper.

## Typography

- **DM Sans** is the primary typeface for all interface text and headings.
- **Fraunces** is reserved for short margin notes and summary callouts. It is not a general display typeface.
- Body copy is at least 14px. Metadata may be 12px when it is not the primary content.
- Headings use strong weight and tight tracking, but sentence case remains the default.
- Avoid generic numbered eyebrows and decorative uppercase text that does not add meaning.

## Product Mark

The favicon is a compact version of the `a.` wordmark: a cobalt lowercase letter, tangerine period, warm-paper field, and black ink outline. Keep it simple enough to remain identifiable at 16px and preserve the outline so it works on both light and dark browser chrome.

## Layout and Spacing

- Desktop content max-width: `1330px`.
- Main page gutters: `28px` desktop, `18px` mobile.
- Use 8–12px internal gaps for compact controls, 16–24px between related groups, and 28–42px between major sections.
- Desktop attendance uses a main register plus a sticky summary note.
- Planner uses the same main-plus-summary relationship.
- At `800px` and below, secondary panels become static and stack beneath the main content.
- At `600px` and below, attendance table rows become self-contained subject cards. Each card must show subject, percentage, recorded hours, and room to move without horizontal scrolling.

## Core Components

### Header and Navigation

Use a standard top navigation with an active tangerine underline. The header may be sticky, but screenshots and print-like captures should avoid stitching the sticky element repeatedly.

### Control Ribbon

The cobalt ribbon summarizes overall recorded attendance and explains that margins are subject-specific. The butter target control belongs to the same group. Changing the target updates all target ticks and budget language together.

### Attendance Register

Desktop uses a compact semantic table. Percentage bars share the same tangerine target marker. Below-target bars use tangerine; available margin remains cobalt.

Mobile uses bordered subject cards generated from the same semantic table:

- Subject and current percentage at the top.
- Recorded hours in a labeled row.
- `What you can afford` in a labeled row.
- No essential result may depend on horizontal scrolling.

### Summary Note

Butter summary surfaces may use Fraunces for one short handwritten-style heading. Keep the quantitative list in DM Sans and preserve the calculator-versus-permission warning.

### Timetable

The timetable can scroll horizontally because it is a true schedule matrix. Keep the weekday column sticky, label unknown/free states explicitly, and preserve 44px interactive controls.

### Leave Planner

Rows show date, scheduled classes, explanatory text, and standard full-day/afternoon buttons. The plan summary shows the cumulative effect and remains a calculation rather than approval.

### Login and Onboarding

Login pairs a cobalt story panel with a familiar portal form. The story may be expressive; the form must remain conventional. Onboarding uses the same cobalt, butter, target-ring, and paper language without page-load choreography.

## Interaction and Motion

- UI transitions should complete in roughly 140–240ms.
- Use the strong ease-out token `cubic-bezier(.23,1,.32,1)` for state changes.
- Animate only explicit properties; never use `transition: all`.
- Prefer `transform` and `opacity`; percentage bars may animate width because the value change is the content.
- Pressed buttons scale to approximately `0.97`.
- Hover movement is allowed only inside `@media (hover:hover) and (pointer:fine)`.
- Do not animate page load or ordinary static content.
- Honor `prefers-reduced-motion` by reducing animation durations and disabling press transforms.

## Accessibility

- All ordinary interactive targets must be at least 44px in both dimensions where layout permits.
- Keyboard focus uses a dual indicator: a white inner outline plus an ink outer ring. This remains visible on paper, butter, cobalt, and white surfaces.
- Composite fields such as password and target controls use `:focus-within` on their visible container.
- Preserve semantic tables, headings, labels, dialog behavior, live regions, and the skip link.
- Never encode status only with color; pair colors with labels such as `Attend 2 hours`, `Unknown`, or `4 hours to spare`.
- Maintain readable text contrast and avoid low-contrast placeholder text.

## Anti-patterns

Do not introduce:

- Generic pale dashboards composed of interchangeable metric cards.
- Excessive floating rounded containers or pill-shaped sections.
- Centered marketing copy inside task-heavy application views.
- Hidden essential data behind mobile horizontal scrolling.
- Decorative emoji or Unicode symbols used as interface icons.
- Bouncy, elastic, or slow transitions.
- Browser-side storage of credentials or Etlab sessions.
