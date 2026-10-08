# Risk acceptance register

**Status: TEMPLATE, NOT SIGNED.** The entries below were prepared by the engineering side for the owner to review. No risk in this
register is accepted until the approver completes the decision, signs and dates the entry. Until then each entry is an open,
undecided finding.

How to use: one row per accepted risk. Do not accept a risk by editing this file without a name, a signature and a date. Re-run the
check on the review date; if the finding is fixed, move the entry to "Closed" with the date and the change that fixed it.

## Register

| ID | Finding | Severity | Scope | Status | Review date | Approver | Decision date |
|---|---|---|---|---|---|---|---|
| RA-001 | `extract-zip` unvalidated symlink path traversal (GHSA-jmr9-qjv8-65gv) | High | Install time only (puppeteer's Chrome download) | **Open, awaiting approval** | Proposed 2027-01-08 [OWNER TO CONFIRM] | [OWNER TO FILL: name and role] | [OWNER TO FILL] |
| RA-002 | `extract-zip` arbitrary file writes through symlink archive entries (GHSA-7pqw-9j4j-h8q3) | High | Install time only (same path) | **Open, awaiting approval** | Proposed 2027-01-08 [OWNER TO CONFIRM] | [OWNER TO FILL: name and role] | [OWNER TO FILL] |

## RA-001 and RA-002: `extract-zip` via puppeteer

### Details
- **Source:** `pnpm audit --prod`, run 2026-10-08 on branch `dev`: 2 vulnerabilities found, both high. Every other finding that audit
  reported earlier has been fixed (22 findings reduced to 2, see `docs/fixes/REMAINING.md`).
- **Package:** `extract-zip@2.0.1`, vulnerable range `<=2.0.1`. The advisory lists **no patched release** (`<0.0.0`), so the
  package cannot be upgraded or pinned out of the problem.
- **Dependency path:** `worker > puppeteer@23.x > @puppeteer/browsers@2.6.1 > extract-zip@2.0.1`. It is reached only through the worker
  (`worker/package.json`, `puppeteer ^23.9.0`); the web app does not depend on it.
- **The weakness:** when extract-zip unpacks a ZIP file that contains a crafted symlink entry, it can write files outside the target
  folder.

### Why exposure is limited
- `@puppeteer/browsers` calls extract-zip from a single place: `unpackArchive`, used by its `install()` function, which unzips the
  Chrome download. In this repository that happens **once, when dependencies are installed** (puppeteer's postinstall step, allowed
  in `package.json` under `pnpm.onlyBuiltDependencies`), on the build machine (Railway builds the worker with `nixpacks.toml`; CI and
  developer machines may set `PUPPETEER_SKIP_DOWNLOAD=1`).
- **There is no runtime path.** The worker (`worker/src/browserPool.ts`) only launches Chrome that is already installed; it never calls
  `install()` and never extracts an archive, and no code in `apps/` or `worker/` imports `extract-zip` or `@puppeteer/browsers`. No
  user-supplied file, upload or URL reaches it. The only archive it can ever unpack is the Chrome build puppeteer downloads from its
  vendor's download host during install.
- An attacker would therefore need to tamper with that download (a compromised download host or a TLS-intercepting build network) at the
  moment of a build, not just reach the running service. At run time the vulnerable code is not executed.

### Mitigation in place and options
- Pinned lock file (`pnpm-lock.yaml`) and `pnpm install --frozen-lockfile` in CI, so the version cannot change silently.
- Build-time only exposure on isolated build machines; production containers run the already-extracted browser. No customer data is
  present on the build machine.
- Optional hardening the owner can choose (none required by this entry): set `PUPPETEER_SKIP_DOWNLOAD=1` and install Chromium from the
  operating system package in the image, then point `PUPPETEER_EXECUTABLE_PATH` at it (the variable already exists), which removes the
  download and unzip step entirely; or move to puppeteer 25 (the version that drops this dependency). Puppeteer is deliberately not upgraded in this release
  (puppeteer 25 removes the `networkidle0` wait that all 11 PDF jobs use, so it needs PDF regression testing first), so neither has been done.

### Decision (owner completes)
- [ ] Accept the risk until the review date, relying on the limited exposure above.
- [ ] Do not accept: take the optional hardening or the puppeteer upgrade first.

Conditions of acceptance, if accepted: re-run `pnpm audit --prod` on the review date and whenever puppeteer is upgraded; re-assess
immediately if any code ever extracts an archive at run time or if a patched `extract-zip` is published.

| Field | Entry |
|---|---|
| Approver name and role | [OWNER TO FILL] |
| Decision (accepted / not accepted) | [OWNER TO FILL] |
| Review date | [OWNER TO FILL] (proposed 2027-01-08) |
| Signature | [OWNER TO SIGN: not signed] |
| Date signed | [OWNER TO FILL] |

## Closed
None.
