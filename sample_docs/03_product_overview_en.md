# Acme VaultDB — Product Overview

## What it is
Acme VaultDB is an encrypted, on-premises document store built for regulated industries — finance, healthcare, and legal. It lets teams index, search, and govern sensitive documents without ever sending data to a third-party cloud.

## Key capabilities
- **Zero-trust architecture.** Every read and write is authenticated, authorized, and audited. No implicit trust between services.
- **Client-side encryption.** Documents are encrypted with per-tenant keys before they touch persistent storage. Keys never leave the customer's hardware security module (HSM).
- **Local semantic search.** An on-device embedding engine powers natural-language search across the entire corpus, with no network calls to external inference providers.
- **Immutable audit log.** Every access event is written to an append-only ledger, satisfying SOC 2, HIPAA, and GDPR evidentiary requirements.

## Why customers choose it
Most knowledge tools assume your data can live in someone else's cloud. For a hospital, a bank, or a law firm, that assumption is a non-starter. VaultDB inverts the model: the intelligence comes to the data, not the other way around.

## Deployment
VaultDB ships as a single signed binary plus a browser-based admin console. A typical air-gapped deployment is operational within one business day. There is no outbound telemetry; the entire system can run inside a network with no internet access.

## Pricing model
VaultDB is licensed per node with an annual support contract. Because all inference runs on customer hardware, there are no per-query inference fees — costs are predictable regardless of usage volume.
