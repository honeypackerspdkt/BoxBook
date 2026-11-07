# @honeypackers/box-core

Shared by the BoxBook app (this repo), the honeypackers.in website and its Netlify functions, so the price a buyer
sees, the price the server charges and the price staff quote always come from the same code.

| Import | What |
|---|---|
| `@honeypackers/box-core/calc` | eBox box maths: `calcBox` (cut size, deckle, weight, BS, paper cost), `estimate`, `orderTotals` |
| `@honeypackers/box-core/pricing` | web price list: `priceCustomBox`, `slabTable`, `findZone`, `deliveryCharge`, `checkoutTotals`, `advanceAmount` |
| `@honeypackers/box-core/box3d` | 3D box geometry for the SVG viewer |
| `@honeypackers/box-core/gst` | GST state codes, `splitTax` |
| `@honeypackers/box-core/words` | amount in words (Indian system) |
| `@honeypackers/box-core/invoice` | tax invoice model + jsPDF drawing (fonts bundled, ₹ included) |
| `@honeypackers/box-core/types` | data model (`BoxSpec`, `Order`, `Customer`, `CompanySettings`, …) |

Source is TypeScript and is consumed as-is (Vite, Astro, vitest, esbuild). Tests: `npx vitest run packages/box-core` from the repo root.
The website repo uses it with a `file:` link to a checkout of this repo next to it, like the rajesh-hub packages.
