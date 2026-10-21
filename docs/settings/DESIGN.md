---
name: Zelo Settings
description: Shipped purple and white operational settings workspace.
colors:
  primary: "#7041db"
  primary-hover: "#5c2cc5"
  page: "#f7f7fa"
  surface: "#fff"
  settings-ink: "#24202b"
  settings-muted: "#706979"
  settings-line: "#e8e5ed"
  tabs-track: "#eeecf2"
  focus: "#b89aef"
  field-line: "#ddd8e5"
  field-focus: "#9870d3"
typography:
  title:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "21px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.55px"
  body:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "13px"
    lineHeight: 1.7
  label:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  caption:
    fontFamily: "Segoe UI, Arial, sans-serif"
    fontSize: "11px"
rounded:
  status: "5px"
  control: "9px"
  container: "12px"
  card: "16px"
spacing:
  compact: "8px"
  small: "12px"
  medium: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 15px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "#51495f"
    rounded: "{rounded.control}"
    padding: "10px 15px"
  settings-card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "28px 30px"
  field:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
---

# Design System: Zelo Settings

## Overview

**Creative North Star: "Restrained functional workspace"**

This scoped record describes the shipped Conexões e IA surface, extracted from `public/panel.css`, inherited primitives in `public/style.css`, structure in `public/index.html`, and behavior in `public/ai-keys.js` and `public/settings-ui.js`. The local direction contract supplies its descriptive language; this is a code-led refinement with no approved comp.

Purple, white and near-black maintain the Zelo identity. Aligned connection rows, compact metadata, explicit statuses and progressively disclosed secondary actions support configuration work. This record does not reconcile the older project-wide Wappy documentation. All seven supported providers use local Lobe Icons SVG marks with provenance and MIT license in public/brand/providers/README.md; adjacent provider names carry accessible identity. Contact rows reserve 58px of left padding for avatars and truncate long names and workspace email. Native activity disclosure presents a count badge and separate message/event sections with an empty-event state. A compact privacy disclosure sits beside a separate logout action; short desktop sidebars compact spacing and scroll vertically.

**Key Characteristics:**
- White bordered panels on a pale neutral canvas.
- Purple selections and primary actions with explicit text states.
- Ordered rows that become stacked groups on small screens.
- Native controls and disclosures with visible keyboard focus.

## Colors

### Primary

Primary purple identifies add, save and connect actions and the checked rotation switch; the darker token is its hover state. Selected tabs, validated statuses and connection modes use contextual pale purple fills and darker violet text.

### Neutral

White surfaces separate cards and fields from the page. Settings ink anchors headings, settings muted carries explanations, and settings line bounds cards. Field borders distinguish editable controls; focus violet identifies keyboard location. The tab track groups navigation.

Waiting states use pale amber with amber text; error states use red-family text with pale red fills. These are semantic exceptions to the purple identity, not additional brand accents.

**The State Has Words Rule.** Availability, validation, waiting, errors and connection state appear as explicit labels; a dot or tint alone is insufficient.

## Typography

**Body Font:** Segoe UI, Arial, sans-serif, inherited from the app.

The compact workspace hierarchy uses weight and spacing within one native family. Titles use the frontmatter title role, reducing to (20px) at narrower breakpoints. Explanations use the body role, capped at (64ch). Fields use (13px) with line height (1.5). Labels and main buttons use (12px), weight (600); key names use (14px), weight (650), line height (1.5). Captions and status text occupy the (11–12px) range. Model IDs inherit the body family despite their code markup and wrap when long.

The surrounding page heading currently uses the inherited system family at (30px), or (27px) on small screens. This is an inherited implementation fact, not a new display typography rule.

## Layout

The inherited shell pairs a (240px) sidebar with flexible content capped at (1512px); desktop content padding is (34px 36px 20px). At (800px), the shell becomes one column. Settings cards have the frontmatter padding, reducing to (24px) at (800px) and (20px 17px) at (580px).

Three tabs share one content region; inactive panels are hidden. At (800px), the segmented track fills available width and distributes tabs evenly.

AI rows use four desktop columns: priority (66px), flexible identity, state (118px), actions (106px), with (18px) gaps and padding (16px 20px). At (1150px), columns contract to (58px), flexible, (102px), (95px), with (12px) gaps. At (580px), priority and identity become two columns (50px and flexible); status and actions stack under identity. Long models and error messages wrap.

Connection mode options use two equal columns, then one at (580px). QR frame and instructions use a (260px) plus flexible grid with (38px) gap, contract at (1150px), and stack at (580px). The assistant note and fields use (220px) plus flexible columns with (42px) gap, becoming one at (800px). Generic field pairs stack at (580px). Small-screen add, generate and save actions fill their available width.

**The Row Becomes a Group Rule.** Small screens retain priority, identity, state and actions together by stacking them in reading order.

## Elevation & Depth

Cards are flat white surfaces separated by borders and tonal fills. Soft shadows distinguish the selected tab (`0 2px 4px #21182f07`), floating action menu (`0 8px 24px #21152f18`) and switch thumb (`0 1px 3px #29202f20`). These are ambient functional cues.

## Shapes

Rounded rectangles organize panels and controls. Cards, fields, shared list containers and small chips use the corresponding frontmatter radii. The tab track is rounded (12px), with selected segments (8px). Small-screen cards reduce to (13px). Circular state dots, selection markers and switch thumbs remain functional geometry.

## Components

### Buttons

Primary buttons use purple, white text, matching border and minimum height (42px). Secondary buttons use white with muted violet text and a pale border; hover lightly tints the surface and strengthens its border. Row edit actions are (34px) minimum, increasing to (38px) on small screens. Disabled actions fade; unavailable reorder directions disable. Keyboard focus uses an outline (3px) with offset (3px).

### Cards / Containers

Panels use a thin settings-line border. The inline key editor has a pale violet fill and container radius. AI connections share one enclosure with row dividers; the next eligible row receives a faint tint and an explicit next-use label.

### Inputs / Fields

Full-width white fields retain visible labels and helper text. Focus shifts the field border and retains the keyboard outline. Password controls protect secret entry; model help uses `aria-describedby`. Invalid Gemini models receive native validity feedback and `aria-invalid`, cleared on edit. Assistant instructions use a resizable textarea with minimum height (240px) and line height (1.9).

### Navigation

Tabs use linked `tablist`, `tab` and `tabpanel` semantics, `aria-selected` and roving tabindex. Arrow keys wrap; Home and End activate and focus the first and last tab. Selection uses a white inset segment, purple text, a light boundary and faint shadow.

### Status chips

A compact chip pairs a current-color dot with a word label. AI states distinguish unverified, validated, paused, waiting and error. Connection badges distinguish disconnected, waiting and connected. Mode buttons use `aria-pressed`, a pale selected fill, purple boundary and circular indicator.

### Ordered connection list

Each row keeps numeric priority, SVG reorder controls, provider mark, label, model, availability and edit visible. All seven supported providers use local SVG marks from Lobe Icons; provenance and MIT license are recorded in `public/brand/providers/README.md`. Marks fit a contained square (26px desktop, 23px small screens); the adjacent provider name carries the accessible identity while the image has empty alt text. Native details contain pause/activate, validation, delete and conditional retry reset. Icon controls have accessible names. Escape closes row menus and restores disclosure focus; outside clicks close menus. Saving makes the list inert and disables add/rotation controls while announcing status.

### Conversation and supporting disclosures

Contact rows reserve left padding (58px) for the avatar; long contact names and workspace email truncate with ellipsis. Activity uses native disclosure with an explicit chevron and count badge; expanded content separates messages to follow from recent events and retains a real empty-event state. The sidebar pairs a compact private-environment disclosure with a separate logout action. Short desktop sidebars compact spacing and allow vertical scrolling, including when privacy is expanded.

### Rotation and WhatsApp connection

The rotation switch is a real checkbox beneath a visual track (42px by 26px). Checked state translates its thumb and turns the track purple. Focus outlines the track with offset (4px). Its transitions (0.18s) disappear under reduced motion. Numbered instructions, descriptive QR image alt text and explicit status messages explain connection progress. Connected state swaps the idle SVG for a check and hides generate. Connection management and priority explanations use native disclosures. Feedback uses `role=status`; key mutation feedback is a polite live region.

## Do's and Don'ts

### Do:
- **Do** retain purple actions, white panels and near-black headings within settings.
- **Do** pair operational statuses with readable labels.
- **Do** preserve linked labels, visible focus, keyboard tab navigation and native disclosures.
- **Do** stack row content and actions together on small screens and wrap long identifiers.
- **Do** use SVG action icons with accessible control names.

### Don't:
- **Don't** imply successful validation from availability or next-use position.
- **Don't** give destructive or uncommon actions the same visual prominence as edit and save.
- **Don't** apply this scoped refinement as a replacement identity for unrelated surfaces.

Not canonized: inherited system-font page display treatment, literal plus/arrow characters in legacy add/link labels, and uppercase sidebar kickers are inherited craft-floor exceptions or out-of-boundary defects, not reusable display/icon/eyebrow rules.


### Motion refinement

`public/motion.css` and `public/motion.js` provide progressive enhancement. Controls remain usable without waiting for motion. Button feedback uses 150ms; state feedback 220ms; panels and disclosure content 240ms; stable AI row reordering 280ms. The shared deceleration is `cubic-bezier(.16,1,.3,1)`. The login keeps its approved composition, with a 380ms symbol focus and 460ms bounded headline reveal.

Keyboard input cancels active movement and uses instant transitions. Reduced-motion preferences disable spatial animation and cancel active Web Animations; hiding the page cancels them too. Each element interrupts its previous animation. No idle loops or repeated animation on dashboard polling. Desktop hover feedback is pointer-gated. On mobile, privacy detail is hidden and logout is compact so it cannot cover navigation.

Verified with 47 automated tests including cancellation, reduced-motion and stable reorder behavior, plus desktop/mobile browser navigation. Settled screenshots verify layout; perceived smoothness was not independently measured with temporal capture.
