#!/usr/bin/env bash
#
# Install the local pre-commit hook.
#
# CI scans for secrets too, but only after a push - by which point the credential has
# left the machine and is on a server, and revoking it is the only real remedy. This hook
# catches it while it is still staged, where deleting a line is the whole fix.
#
# Hooks are not carried by a clone, so this is opt-in per checkout:
#
#   npm run hooks:install
#
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
hook="${repo_root}/.git/hooks/pre-commit"

cat > "$hook" <<'HOOK'
#!/usr/bin/env bash
set -euo pipefail

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "pre-commit: gitleaks is not installed." >&2
  echo "  brew install gitleaks   (or remove .git/hooks/pre-commit to opt out)" >&2
  exit 1
fi

# --staged scans exactly what is about to be committed. --redact keeps a finding from
# printing the secret into a terminal buffer and a scrollback that outlives the commit.
if ! gitleaks git --staged --no-banner --redact --exit-code 1; then
  echo >&2
  echo "pre-commit: a credential looks like it is in the staged changes." >&2
  echo "  Rotate it if it is real; --no-verify only moves the problem to CI." >&2
  exit 1
fi
HOOK

chmod +x "$hook"
echo "Installed ${hook}"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo
  echo "Note: gitleaks is not on PATH, so the hook will refuse every commit until it is."
  echo "  brew install gitleaks"
fi
