# 0010. One web UI codebase, shipped as Windows (Tauri), Android (Capacitor), and browser/PWA

- Status: Accepted
- Date: 2026-09-25

## Context

Stores use Windows PCs at the cashier and Android tablets and phones in the shop, and owners want access from anywhere. POS devices need durable local storage, silent thermal printing, cash-drawer control, and fast camera scanning — which browsers can't guarantee (storage eviction, no silent printing, no WebUSB on Safari, weak camera scanning). Apple distribution for Syrian developers remains uncertain.

## Decision

- One UI codebase in React and TypeScript, with a shared local-database and sync layer.
- Windows app via Tauri (lighter than Electron; suits old hardware), Windows 10 or later.
- Android app via Capacitor (native ML Kit camera scanning, storage, Bluetooth).
- Browser/PWA for remote owner and accountant access, and for iPad/iPhone in V1; never a primary POS.
- Screen sets per form factor: desktop gets everything; tablets get POS, repairs, inventory, reports; phones get task-focused screens.
- The owner dashboard is a permission-gated set of screens inside the same app — the phone home screen for users who hold that permission — not a separate application.
- Deferred: native iOS app, iOS push notifications.

## Consequences

- One codebase, three packaging targets to test.
- Windows 7 is unsupported; customers and resellers must be told.
- A certified hardware list (printers, scanners, drawers) is part of the product.

## Alternatives considered

- **Browser only** — unreliable storage and printing for POS.
- **Flutter** — strong on mobile, weaker for data-heavy web back-office screens.
- **Electron** — heavier on the old PCs common in Syrian shops.
- **A separate owner app** — duplicated auth, permissions, and code.
