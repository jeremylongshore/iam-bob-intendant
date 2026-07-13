# Security Policy

## Security Model (honest scope)

Bob the Intendant is the **agent/composition layer**. It composes
[`agent-governance-plane`](https://github.com/jeremylongshore/agent-governance-plane)
(AGP) as a pinned dependency, and the governance runtime — the policy gate, Docker
sandbox, Slack human-in-the-loop approval, and the signed hash-chained audit
journal — is implemented in **AGP**, not in Bob. The one property Bob's governed
loop provides through that composed runtime is a **signed audit log of every tool
call**. Bob does not make any stronger assurance claim; treat everything else as
best-effort engineering, not a guaranteed property. Bob is **PRIVATE v0** and
pre-1.0 — expect gaps, and report anything you find.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest | Yes |
| < latest | Best effort |

## Reporting a Vulnerability

**Please do NOT open public issues for security concerns.**

Email **jeremy@intentsolutions.io** with:

- Type of issue (e.g., buffer overflow, injection, privilege escalation)
- Full paths of related source files
- Location of the affected code (tag/branch/commit or direct URL)
- Any special configuration required to reproduce
- Step-by-step instructions to reproduce
- Proof-of-concept or exploit code (if possible)
- Impact assessment

### Response Timeline

| Stage | Timeframe |
|-------|-----------|
| Acknowledgment | 24 hours |
| Initial assessment | 48 hours |
| Status update | 5 business days |
| Resolution | Depends on severity |

### Severity Levels

| Severity | CVSS | Examples | Target Resolution |
|----------|------|---------|-------------------|
| Critical | 9.0–10.0 | Remote code execution, credential theft | 24 hours |
| High | 7.0–8.9 | Privilege escalation, data exposure | 7 days |
| Medium | 4.0–6.9 | Cross-site scripting, denial of service | 30 days |
| Low | 0.1–3.9 | Information disclosure, minor issues | 90 days |

## Disclosure Process

1. **Report** — You email the details to jeremy@intentsolutions.io
2. **Triage** — We assess severity and impact
3. **Fix** — We develop and test a patch
4. **Notify** — We inform affected users
5. **Release** — We publish the fix
6. **Post-Mortem** — We document lessons learned

Note: a vulnerability in the governance runtime (policy gate, sandbox, HITL, or
the journal) belongs to AGP. We will coordinate the report upstream to AGP where
appropriate; you only need to email the address above.

## Security Best Practices

When contributing to this project:

- Never hardcode credentials or secrets
- Validate all input at system boundaries
- Keep dependencies up to date (including the pinned AGP kernel)
- Use HTTPS for all external communication
- Follow the principle of least privilege
- Do not log sensitive information
- Write tests for security-critical paths

## Recognition

We appreciate responsible disclosure. Reporters who follow this policy will receive:

- Credit in security advisories (unless anonymity is preferred)
- Mention in CONTRIBUTORS.md
- Our sincere gratitude

## Contact

- **Security reports**: jeremy@intentsolutions.io
- **General inquiries**: jeremy@intentsolutions.io
- **Response time**: 24 hours for initial acknowledgment
