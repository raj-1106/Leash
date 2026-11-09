#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.cargo/bin:${PATH}"

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="/tmp/leash-repro-validation"

TARGET_REF="${1:-${REF:-HEAD}}"

echo "========================================================"
echo " LEASH // 2x Clean-Clone Reproducible Build Verification "
echo "========================================================"
echo "Source Repo:         ${REPO_DIR}"
echo "Requested Ref:       ${TARGET_REF}"
echo "Validation Temp Dir: ${WORK_DIR}"
echo ""

# 1. Check for uncommitted changes in source repo
cd "${REPO_DIR}"
if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠️ Working directory in ${REPO_DIR} has uncommitted changes."
  echo "Commit all changes before running the reproducible build verification:"
  echo "  git add ."
  echo "  git commit -m 'chore: prepare for reproducible build'"
  exit 1
fi

# Verify ref exists in source repo
if ! git rev-parse --verify "${TARGET_REF}^{commit}" >/dev/null 2>&1; then
  echo "❌ Error: Target ref '${TARGET_REF}' does not exist or is not a valid commit in ${REPO_DIR}"
  exit 1
fi

RESOLVED_COMMIT="$(git rev-parse "${TARGET_REF}^{commit}")"
echo "Resolved Commit:     ${RESOLVED_COMMIT}"
echo ""

# Clean previous validation runs
rm -rf "${WORK_DIR}"
mkdir -p "${WORK_DIR}"

# ----------------------------------------------------
# RUN 1: Clean Clone 1
# ----------------------------------------------------
echo "--------------------------------------------------------"
echo ">> RUN 1: Cloning into ${WORK_DIR}/clone-1..."
echo "--------------------------------------------------------"
git clone "${REPO_DIR}" "${WORK_DIR}/clone-1"
cd "${WORK_DIR}/clone-1"
git checkout "${TARGET_REF}"
CLONE1_COMMIT="$(git rev-parse HEAD)"
echo "Clone 1 checked out ref '${TARGET_REF}' -> commit ${CLONE1_COMMIT}"

echo "Building reproducible WASM for agent-account and NFT (Run 1)..."
cargo near build reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml
cargo near build reproducible-wasm --manifest-path contracts/nft/Cargo.toml

echo "Calculating Run 1 checksums..."
sha256sum target/near/agent_account/agent_account.wasm target/near/nft/nft.wasm > "${WORK_DIR}/hashes-run1.txt"
cat "${WORK_DIR}/hashes-run1.txt"
echo ""

# ----------------------------------------------------
# RUN 2: Clean Clone 2
# ----------------------------------------------------
echo "--------------------------------------------------------"
echo ">> RUN 2: Cloning into ${WORK_DIR}/clone-2..."
echo "--------------------------------------------------------"
git clone "${REPO_DIR}" "${WORK_DIR}/clone-2"
cd "${WORK_DIR}/clone-2"
git checkout "${TARGET_REF}"
CLONE2_COMMIT="$(git rev-parse HEAD)"
echo "Clone 2 checked out ref '${TARGET_REF}' -> commit ${CLONE2_COMMIT}"

echo "Building reproducible WASM for agent-account and NFT (Run 2)..."
cargo near build reproducible-wasm --manifest-path contracts/agent-account/Cargo.toml
cargo near build reproducible-wasm --manifest-path contracts/nft/Cargo.toml

echo "Calculating Run 2 checksums..."
sha256sum target/near/agent_account/agent_account.wasm target/near/nft/nft.wasm > "${WORK_DIR}/hashes-run2.txt"
cat "${WORK_DIR}/hashes-run2.txt"
echo ""

# ----------------------------------------------------
# VERIFICATION & COMPARISON
# ----------------------------------------------------
echo "--------------------------------------------------------"
echo ">> Comparing Run 1 vs Run 2 Checksums..."
echo "--------------------------------------------------------"

if diff -u "${WORK_DIR}/hashes-run1.txt" "${WORK_DIR}/hashes-run2.txt"; then
  echo ""
  echo "========================================================"
  echo "🎉 HASH STABILITY CONFIRMED! (2x RUN MATCHES 100%)"
  echo "========================================================"
  echo "Target Ref:      ${TARGET_REF}"
  echo "Built Commit:    ${RESOLVED_COMMIT}"
  echo "Clone 1 Commit:  ${CLONE1_COMMIT}"
  echo "Clone 2 Commit:  ${CLONE2_COMMIT}"
  echo ""
  echo "Verified Reproducible Checksums:"
  cat "${WORK_DIR}/hashes-run1.txt"
  echo ""
  echo "Both agent_account.wasm and nft.wasm produced identical"
  echo "byte-for-byte hashes across independent clean clones."
  echo "========================================================"

  # Write artifacts to dist/<TARGET_REF>/
  DIST_DIR="${REPO_DIR}/dist/${TARGET_REF}"
  mkdir -p "${DIST_DIR}"
  cp "${WORK_DIR}/clone-2/target/near/agent_account/agent_account.wasm" "${DIST_DIR}/agent_account.wasm"
  cp "${WORK_DIR}/clone-2/target/near/nft/nft.wasm" "${DIST_DIR}/nft.wasm"
  (cd "${DIST_DIR}" && sha256sum agent_account.wasm nft.wasm > SHA256SUMS)
  echo ""
  echo "✓ Official release artifacts and checksums written to: ${DIST_DIR}"
  cat "${DIST_DIR}/SHA256SUMS"
  echo "========================================================"
else
  echo "❌ MISMATCH DETECTED between Run 1 and Run 2!"
  exit 1
fi
