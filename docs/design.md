# design.md

## 1. Design Style
Clean, modern, and fast to read. Warm "food" colors, big buttons, and plenty of white space. The app is used all day at the counter, so it must be easy on the eyes and quick to tap.

## 2. Color Palette

### Brand colors
| Name | Hex | Use |
|---|---|---|
| Primary (Tomato Red) | `#E63946` | Main buttons, active menu, highlights |
| Primary Dark | `#C1121F` | Button hover |
| Secondary (Mustard Yellow) | `#FFB703` | Accents, badges, warnings |
| Accent (Orange) | `#FB8500` | Secondary actions, charts |

### Neutrals
| Name | Hex | Use |
|---|---|---|
| Background | `#F8F9FA` | App background |
| Surface | `#FFFFFF` | Cards, tables, modals |
| Border | `#E5E7EB` | Lines and inputs |
| Text Primary | `#1F2937` | Main text |
| Text Secondary | `#6B7280` | Labels, hints |
| Sidebar | `#1F2937` | Left navigation (dark) |

### Status colors
| Status | Hex |
|---|---|
| Success / Delivered | `#2A9D8F` |
| Pending | `#FFB703` |
| Preparing | `#3B82F6` |
| Cancelled / Error | `#DC2626` |

## 3. Theme
- **Light theme** by default.
- Dark sidebar with light content area.
- Optional dark mode can be added later.

## 4. Fonts
- **Headings:** Poppins (600, 700)
- **Body and UI:** Inter (400, 500, 600)
- **Numbers (prices, totals):** Inter with tabular numbers
- **Invoice (thermal):** a monospace font such as `Courier New` or `Consolas` for aligned columns
- Fonts are **bundled inside the app** (no internet needed). Fallback: `system-ui, Segoe UI, sans-serif`.
- If Urdu is added later: **Noto Nastaliq Urdu**.

## 5. Typography Scale
| Use | Size | Weight |
|---|---|---|
| Page title | 28px | 700 |
| Section title | 20px | 600 |
| Card title | 16px | 600 |
| Body text | 14px | 400 |
| Labels and captions | 12px | 500 |
| Big numbers (dashboard) | 32px | 700 |
| Buttons | 14px | 600 |

Line height: 1.5 for body, 1.2 for headings.

## 6. Spacing and Shape
- Spacing scale: 4, 8, 12, 16, 24, 32px
- Card radius: 12px
- Button and input radius: 8px
- Card shadow: `0 1px 3px rgba(0,0,0,0.08)`
- Minimum button height: 40px (48px on the New Order screen)

## 7. Components
- **Buttons:** Primary (red), Secondary (outlined), Danger, Ghost
- **Inputs:** 40px high, light border, red focus ring
- **Tables:** striped rows, sticky header, hover highlight
- **Cards:** white, rounded, soft shadow
- **Badges:** colored pill for order status
- **Modals:** centered, with dim background
- **Toasts:** top right for success and error
- **Icons:** lucide-react, 20px

## 8. Layout
- Left sidebar (240px) with icons and labels
- Top bar with shop name, current user, and logout
- Content area with max width and 24px padding
- **New Order screen:** menu items grid on the left (about 65%), current order and totals on the right (about 35%)

## 9. Invoice Design
- 80mm thermal width (about 302px)
- Centered shop logo, name, address, phone
- Invoice no., date, time, cashier
- Item table: name, qty, price, total
- Subtotal, discount, tax, **Grand Total (bold, larger)**
- Footer: "Thank you for visiting!"

## 10. Accessibility
- Text contrast of at least 4.5:1
- Never use color alone to show status (also show text)
- Full keyboard support on the New Order screen
