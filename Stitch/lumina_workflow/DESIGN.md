# Design System Document

## 1. Overview & Creative North Star: "The Precision Atelier"
This design system moves beyond the rigid, "boxed-in" utility of standard image processing software. Our Creative North Star is **The Precision Atelier**—a space that feels like a high-end physical studio: clean, organized, and layered. 

Instead of a flat, grid-based interface, we utilize **Tonal Architecture**. We break the "template" look by favoring intentional white space (the `16` and `24` spacing tokens) and organic layering over traditional borders. The interface should feel like stacked sheets of architectural vellum, where depth is defined by light and shadow rather than ink and lines. This creates a "tool-oriented" environment that remains uncluttered, even when complex batch processing controls are active.

---

## 2. Colors & Surface Philosophy
The palette is rooted in deep indigos (`primary`) and sophisticated grays, but its power lies in how these colors are layered to create hierarchy.

### The "No-Line" Rule
To achieve a premium, editorial feel, **1px solid borders are prohibited for sectioning.** Use background shifts to define boundaries.
*   **Application:** Place a `surface_container` sidebar against a `surface` main workspace.
*   **Result:** A clean, modern transition that reduces visual noise and focuses the user on the image content.

### Surface Hierarchy & Nesting
Treat the UI as a physical stack. Use the following hierarchy to guide the eye:
1.  **Base Layer:** `surface` (#f7f9fc) – The primary canvas.
2.  **Sectioning:** `surface_container_low` (#f0f4f8) – Large organizational zones (e.g., the batch list background).
3.  **Interactive Elements:** `surface_container_lowest` (#ffffff) – Individual image cards or control panels. This "pops" against the darker containers.

### The "Glass & Gradient" Rule
For floating elements, such as image property overlays or "Processing" status HUDs, use **Glassmorphism**. Combine `surface_container_lowest` at 80% opacity with a `backdrop-blur` of 12px. 
*   **Signature Textures:** For the primary "Process Batch" button, apply a subtle linear gradient from `primary` (#4956b4) to `primary_container` (#8c99fc) at a 135-degree angle. This adds "soul" and a tactile, liquid quality to the main action.

---

## 3. Typography: Editorial Authority
We use a dual-font system to balance technical precision with high-end aesthetics.

*   **Display & Headlines (Manrope):** Used for workspace titles and large numeric indicators (e.g., "428 Images Selected"). The wider tracking and geometric builds of Manrope provide an authoritative, editorial feel.
*   **Body & Labels (Inter):** Used for all technical data, slider labels, and input fields. Inter’s tall x-height ensures maximum readability at small sizes (`label-sm` 0.6875rem) during complex batch editing.
*   **Hierarchy Note:** Use `on_surface_variant` (#596065) for labels to create a soft contrast against the `on_surface` (#2c3338) values. This makes the data—the most important part of the tool—stand out.

---

## 4. Elevation & Depth
In this system, depth is a functional tool, not a decoration.

*   **Tonal Layering:** Avoid shadows for static components. Elevate a card by placing a `surface_container_lowest` card on a `surface_container_high` background.
*   **Ambient Shadows:** For active "floating" states (e.g., dragging an image to a new folder), use a shadow with a 24px blur, 4% opacity, using the `on_surface` color tinted with `primary_dim`. This mimics natural light.
*   **The "Ghost Border" Fallback:** If a divider is required for accessibility in high-density tables, use the `outline_variant` token at **15% opacity**. It should be felt, not seen.

---

## 5. Components

### Buttons & Interaction
*   **Primary Action:** Rounded (`full`), using the signature gradient. Padding: `spacing-3` (top/bottom) and `spacing-6` (sides).
*   **Secondary/Tertiary:** No background. Use `primary` text. On hover, use a `surface_container_high` ghost fill.

### Control Panels (Sliders & Toggles)
*   **Sliders:** Use `primary` for the active track and `outline_variant` for the inactive track. The thumb should be a `surface_container_lowest` circle with a subtle `primary` ring.
*   **Toggles:** Use the MD3 "Switch" pattern. When "On," the track is `primary_container` and the icon/thumb is `on_primary_container`.

### Image Cards & Lists
*   **The "No-Divider" Rule:** Images in the batch list are separated by `spacing-4` (0.9rem) of white space. 
*   **Active State:** Instead of a thick border, signify a selected image by changing the card background to `primary_fixed` and adding a `primary` corner "check" chip using `rounded-sm`.

### Side Navigation
*   **Style:** Minimalist. Icons use `on_surface_variant`. 
*   **Active Indicator:** A vertical "pill" (width: 4px, height: 24px) in `primary` placed at the left edge of the active icon, rather than highlighting the entire row.

### Detailed Control Panels
*   **Nesting:** Group related settings (e.g., "Color Correction," "Resizing") inside `surface_container_high` rounded boxes (`rounded-lg`). Use `title-sm` (Inter, Bold) for section headers.

---

## 6. Do’s and Don’ts

### Do
*   **Do** use `surface_container` tiers to create logical groupings.
*   **Do** favor vertical white space over horizontal lines.
*   **Do** use `tertiary` (#71557c) for "Soft Actions" like adding metadata or tags—it keeps the primary flow focused on the indigo tones.
*   **Do** ensure all interactive targets are at least `spacing-10` in height for desktop ergonomics.

### Don't
*   **Don't** use pure black (#000000) for shadows or text; always use the `on_surface` or `on_background` tokens to maintain the sophisticated blue-gray tonal range.
*   **Don't** use 1px solid borders to separate the sidebar from the main content; use a color shift from `surface_container_low` to `surface`.
*   **Don't** use `error` (#a8364b) for non-critical warnings. Use `error_container` for a softer, more professional "information required" state.