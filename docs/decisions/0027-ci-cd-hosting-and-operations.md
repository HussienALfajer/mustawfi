# 0027. GitHub Actions CI/CD; pilot hosting on the existing company server with isolation and off-site backups; Sentry EU for errors

- Status: Accepted
- Date: 2026-09-25

## Context

The product must be built, tested, and released for three client platforms and a server. The user chose to start on the company's existing Contabo VPS (which also serves vertexsystem.de) and to move to a better server after roughly five customers. The recommendation was a separate VPS; the risks of sharing are recorded below. Accounting data needs continuous, off-site, tested backups, and single-tenant restore is a launch gate (`v1-scope.md` §7, §10).

## Decision

**CI (GitHub Actions)** — on every pull request: install (pnpm cache), build, lint, typecheck, boundary checks, unit, integration (Testcontainers), end-to-end (Playwright). `pnpm verify` runs the same steps locally. On `main` and nightly, add a Windows job (Tauri build) and an Android build job.

**Releases** — a version tag builds:
- Docker images for `server`, `admin-api`, and `portal-api`, plus the static web and admin builds, pushed to GitHub Container Registry;
- the Windows installer, with updates signed through the Tauri updater. An Authenticode certificate is a business-track item; until it exists, installers show a SmartScreen warning and resellers are told;
- a signed Android build (Play bundle and direct APK).

**Hosting (pilot)** — the existing company Contabo VPS, isolated as far as a shared host allows:
- its own Docker Compose project and network;
- PostgreSQL reachable only on that internal network, never exposed;
- CPU and memory limits on every container;
- TLS at the host's reverse proxy;
- separate subdomains for the app, the admin console (IP allowlist), and the portal;
- secrets in root-only files outside the repository.

Staging is a separate Compose project with its own database on the same host. Whether Docker is already installed on the host, and whether the existing reverse proxy can front the containers, is checked in the `ops` unit before the first deployment.

**Move trigger:** move to a dedicated server before the first paying customer or at the fifth customer, whichever comes first. The deployment is Docker Compose, so moving means restoring a backup on the new host and switching DNS.

**Deployment** — GitHub Actions connects over SSH, pulls the images, runs migrations as a one-off container (as `mustawfi_owner`), then starts the new version. Rollback redeploys the previous image tag; expand/contract migrations (ADR-0016) keep the previous version compatible.

**Backups**
- pgBackRest: continuous WAL archiving plus scheduled full and differential backups to encrypted object storage at **a provider other than Contabo** (chosen in the `ops` unit). Retention: 30 days, plus 12 monthly backups. Target RPO 5 minutes, RTO 4 hours in the pilot.
- A daily encrypted logical export per tenant (the `core.data` full export), which provides single-tenant restore.
- An automated weekly restore drill into a scratch container that checks row counts and that the ledger balances; a failed drill alerts.
- Contabo snapshots are not counted as backups.

**Observability**
- Pino JSON logs with request, tenant, and device IDs and no personal data; rotated.
- **Sentry SaaS, EU region**, for the server, web, Tauri, and Capacitor apps, with source maps uploaded in CI and personal data scrubbed before sending. Errors that happen on an offline client are queued locally and sent after sync. GlitchTip (same SDK, self-hosted) is the fallback if the Sentry account becomes unavailable.
- External uptime checks on health endpoints, alerting the owner.
- Each device's app version and last sync are visible in the admin console.
- OpenTelemetry tracing is deferred until there is more than one process to trace.

## Consequences

- Risks accepted by the user for the pilot, on a shared host:
  - a resource spike on the company website can slow down the tills' sync;
  - a compromise of the website exposes the host running accounting data;
  - Contabo's shared disk performance varies.

  Local-first clients limit the business impact: selling never waits for the server. Off-site backups limit data loss.
- Operations need a runbook: deployment, restore, key custody (ADR-0021), and the host move. It is written in the `ops` unit, which the roadmap adds before the closed beta.

## Alternatives considered

- **A separate Contabo or Hetzner VPS** (recommended) — isolation from the company website at a small monthly cost; declined for the pilot.
- **Managed database in a large cloud** — built-in point-in-time recovery, but several times the cost before revenue.
- **Self-hosted GlitchTip first** — keeps data in-house, but is one more service to run on a shared host.
