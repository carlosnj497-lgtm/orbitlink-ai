# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security vulnerabilities.

Use GitHub's private vulnerability reporting: **Security → Report a vulnerability** (Security Advisories). If that option is unavailable, contact the maintainer privately through GitHub.

Include as much detail as possible:

- affected version, tag, or commit;
- steps to reproduce;
- impact and affected component (agent, dashboard, Telegram, ESP32, Supabase, installer);
- logs or screenshots with tokens, passwords, IPs, and personal data removed.

## Scope

The full security model is in [docs/SECURITY.md](../docs/SECURITY.md). It covers the exposed surface, authentication, control actions, ESP32 pairing, Supabase RLS, AI boundaries, audio handling, and secrets at rest.

## Supported versions

Security fixes are applied to the latest release on `main`.
