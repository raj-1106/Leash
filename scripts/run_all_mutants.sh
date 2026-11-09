#!/usr/bin/env bash
set -e

MUTANTS=(
    "scripts/mutant_per_tx.patch:test_spend_fails_on_per_tx_cap"
    "scripts/mutant_take_clone.patch:test_concurrent_executes_pay_once_with_overlap_precondition"
    "scripts/mutant_ring_sum.patch:test_spend_fails_on_period_cap"
    "scripts/mutant_allowlist.patch:test_spend_fails_on_non_allowlisted_recipient"
    "scripts/mutant_paused.patch:test_spend_fails_when_paused"
    "scripts/mutant_predecessor.patch:test_spend_fails_when_predecessor_is_not_self"
    "scripts/mutant_signer_key.patch:test_spend_fails_when_called_by_full_access_key"
    "scripts/mutant_storage_floor.patch:test_spend_fails_below_storage_floor"
    "scripts/mutant_spend_advance.patch:test_contract_level_sliding_window_advances_and_clears_elapsed_spend"
    "scripts/mutant_expiry.patch:test_owner_timelock_execute_window_and_expiry"
    "scripts/mutant_always_panic_slot.patch:test_owner_overwrites_stale_slot_with_new_request"
    "scripts/mutant_tighten_allow_raise.patch:test_owner_tighten_caps_instant_and_enforces_monotonicity"
    "scripts/mutant_owner_auth.patch:test_middleman_proxy_contract_cannot_spoof_owner"
    "scripts/mutant_proposer_is_owner.patch:test_owner_sale_clears_approvals_and_transfers_supervisory_control"
)

TOTAL=${#MUTANTS[@]}
PASSED=0

echo "=== Running Mutation Test Suite ($TOTAL mutants) ==="

for item in "${MUTANTS[@]}"; do
    IFS=":" read -r patch test <<< "$item"
    echo ""
    echo "--------------------------------------------------------"
    echo "Running Mutant: $patch against $test"
    echo "--------------------------------------------------------"
    if ./scripts/mutate.sh "$patch" "$test"; then
        PASSED=$((PASSED + 1))
    else
        echo "❌ Mutant failed: $patch"
        exit 1
    fi
done

echo ""
echo "========================================================"
echo "🎯 ALL $PASSED / $TOTAL MUTANTS CAUGHT CLEANLY!"
echo "========================================================"
