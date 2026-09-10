# SECURITY.md

## Reporting a vulnerability
Open a private security advisory on this repository (Security → Advisories → Report a vulnerability). Do not open a public issue. Expect an acknowledgement within 7 days.

## Repository hygiene (enforced)

| Control | Mechanism |
|---|---|
| Commit identity | Per-repo `user.name = <github-username>`, `user.email = <id>+<username>@users.noreply.github.com`. GitHub setting "Block command line pushes that expose my email" ON. Commits SSH-signed. |
| No private data in git | `CLAUDE.md`, `CPETracker/` (all planning docs and owner context), `imports/`, `data/`, `*.csv`, backups gitignored; pre-commit and CI guards reject them if staged/tracked; tests use synthetic identifiers only |
| Secret scanning | gitleaks: pre-commit (staged), pre-push (branch), CI (full), and as a gate in `npm run deploy`. GitHub push protection enabled. |
| Branch protection | `main`: PR required, status checks (`ci`, `security`) required, linear history, no force-push, no deletion. All work on `dev` or `feat/*`. Pre-commit hook refuses commits on `main`. |
| CI permissions | `permissions: contents: read` by default; actions pinned to commit SHAs; `pull_request_target` never used; no secrets exposed to fork PRs |
| Deploy credentials | None in GitHub. Cloudflare deploys run from the owner's machine via `wrangler login`. (DECISIONS D-028) |
| Dependencies | Lockfile committed, `npm ci`, Dependabot (npm, actions, docker), `npm audit --audit-level=high` in CI |
| Container | Non-root user, base image pinned by digest, `.dockerignore` excludes `.git`, private files, env files |
| Application | Zero secrets at deploy; owner account created at `/setup`; session key generated into the DB; no telemetry |

## Setup commands (owner, once per clone)

```
git config user.name "<github-username>"
git config user.email "<id>+<username>@users.noreply.github.com"
git config gpg.format ssh
git config user.signingkey ~/.ssh/id_ed25519.pub
git config commit.gpgsign true
npx lefthook install
```

Install gitleaks in WSL (package or release binary) so the hooks work.

## Before the repo goes public (Stage 5)
- `gitleaks detect` over full history, zero findings
- `git log --all --format='%an %ae' | sort -u` shows only the noreply identity
- `git grep -i "<real name>"` and `git log -S"<real name>" --all` return nothing
- No fixture or test contains a real certification or member number
- `SECURITY.md` advisory reporting enabled in repo settings
