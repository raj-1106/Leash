#!/usr/bin/env bash
set -e

PATCH_FILE="$1"
TEST_NAME="$2"

if [ -z "$PATCH_FILE" ] || [ -z "$TEST_NAME" ]; then
    echo "Usage: ./scripts/mutate.sh <patch_file> <test_name>"
    exit 1
fi

if [ ! -f "$PATCH_FILE" ]; then
    echo "Error: Patch file not found: $PATCH_FILE"
    exit 1
fi

# Guard against dirty contracts tree
if [ -n "$(git status --porcelain contracts/)" ]; then
    echo "❌ Refusing to run on dirty contracts/ tree. Please commit or stash changes first."
    exit 1
fi

cleanup() {
    git apply -R "$PATCH_FILE" 2>/dev/null || true
    make build >/dev/null 2>&1 || true
}
trap cleanup INT TERM

echo "=== [MUTATE] Applying mutation: $PATCH_FILE ==="
git apply "$PATCH_FILE"

# Step 1: Ensure compilation succeeds (mutant must compile cleanly)
echo "=== [MUTATE] Building mutated contract (must compile cleanly) ==="
if ! make build > /tmp/mutate_build.log 2>&1; then
    echo "❌ MUTATION BUILD ERROR: Patch failed to compile!"
    cat /tmp/mutate_build.log
    git apply -R "$PATCH_FILE"
    exit 1
fi

# Step 2: Run test suite expecting test failure
echo "=== [MUTATE] Running test: $TEST_NAME (expecting failure) ==="
TEST_OUTPUT=$(cargo test -p integration-tests --test contract_tests "$TEST_NAME" -- --nocapture 2>&1 || true)

# Step 3: Revert mutation patch immediately
echo "=== [MUTATE] Reverting mutation patch: $PATCH_FILE ==="
git apply -R "$PATCH_FILE"

# Rebuild clean WASMs after test
make build >/dev/null 2>&1

trap - INT TERM

# Step 4: Verify that test actually FAILED
if echo "$TEST_OUTPUT" | grep -q "test $TEST_NAME ... FAILED"; then
    PANIC_LINE=$(echo "$TEST_OUTPUT" | grep -E 'panicked at|assertion `.*` failed|assertion failed' | head -n 2 | sed 's/^[ \t]*/   /')
    echo "✅ MUTATION CAUGHT: Test suite failed as expected."
    if [ -n "$PANIC_LINE" ]; then
        echo "$PANIC_LINE"
    fi
    exit 0
else
    echo "❌ MUTATION ESCAPED: Test suite passed on mutant!"
    echo "$TEST_OUTPUT"
    exit 1
fi
