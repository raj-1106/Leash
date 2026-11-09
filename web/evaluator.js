/**
 * LEASH // Pure Evaluation Engine & Mathematical Invariants
 * Pure TypeScript / JavaScript with ZERO Node.js dependencies.
 * Shared directly across Node CLI and Browser Inspector via ESM.
 */
/**
 * Deterministic 5-outcome evaluation state machine.
 */
export function evaluateVerification(params) {
    const details = [];
    const failingRules = [];
    const totalKeys = params.accountKeys.length;
    const fullAccessKeys = params.accountKeys.filter((k) => k.access_key && k.access_key.permission === 'FullAccess');
    const functionCallKeys = params.accountKeys.filter((k) => k.access_key &&
        typeof k.access_key.permission === 'object' &&
        k.access_key.permission.FunctionCall);
    const hasZeroFullAccessKeys = fullAccessKeys.length === 0;
    if (!hasZeroFullAccessKeys) {
        failingRules.push('ZERO_FULL_ACCESS_KEYS');
        details.push(`Found ${fullAccessKeys.length} FullAccess key(s). Account is NOT keyless.`);
    }
    if (totalKeys !== 1) {
        failingRules.push('EXACTLY_ONE_KEY');
        details.push(`Expected exactly 1 access key, got ${totalKeys}.`);
    }
    let hasSingleScopedSpendKey = false;
    if (functionCallKeys.length === 1) {
        const perm = functionCallKeys[0].access_key.permission.FunctionCall;
        const receiverId = perm.receiver_id;
        const methods = perm.method_names || [];
        const allowance = perm.allowance;
        const receiverOk = receiverId === params.accountId;
        const methodsOk = methods.length === 1 && methods[0] === 'spend';
        const allowanceOk = allowance !== null &&
            allowance !== undefined &&
            allowance !== '0' &&
            BigInt(allowance) > 0n;
        if (!receiverOk) {
            failingRules.push('RECEIVER_IS_SELF');
            details.push(`FunctionCall receiver is '${receiverId}', expected '${params.accountId}'.`);
        }
        if (!methodsOk) {
            failingRules.push('METHODS_SPEND_ONLY');
            details.push(`Expected method_names ['spend'], got ${JSON.stringify(methods)}.`);
        }
        if (!allowanceOk) {
            failingRules.push('FINITE_NONZERO_ALLOWANCE');
            details.push(`Allowance must be finite non-zero, got '${allowance}'.`);
        }
        if (receiverOk && methodsOk && allowanceOk) {
            hasSingleScopedSpendKey = true;
        }
    }
    else {
        failingRules.push('SINGLE_SCOPED_SPEND_KEY');
        details.push(`Expected exactly 1 FunctionCall key, got ${functionCallKeys.length}.`);
    }
    const keysLocked = hasZeroFullAccessKeys && hasSingleScopedSpendKey && totalKeys === 1;
    // Code inspection
    let isTesting = params.isTestingWasm;
    if (params.codeSha256 && params.forbiddenHashes && params.forbiddenHashes.includes(params.codeSha256.toLowerCase())) {
        isTesting = true;
    }
    if (isTesting) {
        failingRules.push('FORBIDDEN_TESTING_BUILD');
        details.push('Deployed bytecode contains testing export or matches forbidden test hash.');
    }
    // Hash match checks
    const agentHashMatches = Boolean(params.expectedAgentSha &&
        params.codeSha256 &&
        params.codeSha256.toLowerCase() === params.expectedAgentSha.toLowerCase());
    if (!agentHashMatches) {
        failingRules.push('WASM_HASH_MATCH');
        if (!params.expectedAgentSha) {
            details.push('Published agent WASM hash is null/empty in release configuration.');
        }
        else {
            details.push(`Agent WASM hash mismatch. On-chain: '${params.codeSha256}', expected: '${params.expectedAgentSha}'.`);
        }
    }
    // NFT verification
    let nftVerified = true;
    if (params.nftContractId) {
        if (params.nftKeys && params.nftKeys.length > 0) {
            nftVerified = false;
            failingRules.push('NFT_ZERO_KEYS');
            details.push(`NFT contract '${params.nftContractId}' has ${params.nftKeys.length} keys, expected 0.`);
        }
        if (params.expectedNftSha) {
            const nftHashMatches = Boolean(params.nftCodeSha256 &&
                params.nftCodeSha256.toLowerCase() === params.expectedNftSha.toLowerCase());
            if (!nftHashMatches) {
                nftVerified = false;
                failingRules.push('NFT_WASM_HASH_MATCH');
                details.push(`NFT WASM hash mismatch. On-chain: '${params.nftCodeSha256}', expected: '${params.expectedNftSha}'.`);
            }
        }
    }
    let status;
    if (!keysLocked) {
        status = 'NOT_LOCKED';
    }
    else if (isTesting) {
        status = 'TESTING_BUILD';
    }
    else if (!agentHashMatches || !nftVerified) {
        status = 'KEYS_LOCKED_CODE_UNVERIFIED';
    }
    else {
        status = 'LOCKED_AND_VERIFIED';
    }
    return {
        status,
        keysLocked,
        hasZeroFullAccessKeys,
        hasSingleScopedSpendKey,
        nftVerified,
        failingRules,
        details,
    };
}
// ── Pure Helpers ─────────────────────────────────────────────────────────────
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/**
 * Encodes a Uint8Array into a Base58 string (Bitcoin/NEAR alphabet).
 */
export function base58Encode(source) {
    if (source.length === 0)
        return '';
    const digits = [0];
    for (let i = 0; i < source.length; i++) {
        let carry = source[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }
    let str = '';
    for (let i = 0; i < source.length && source[i] === 0; i++) {
        str += '1';
    }
    for (let i = digits.length - 1; i >= 0; i--) {
        str += ALPHABET[digits[i]];
    }
    return str;
}
/**
 * Estimates number of calls achievable under a FunctionCall key allowance:
 * floor((allowance - (gas * 1e9 + 918880207164400000000)) / (netBurnGas * 1e8))
 */
export function estimateCalls(allowanceYocto, attachedGasTgas = 30, netBurnSuccessTgas = 4.39, netBurnRevertTgas = 1.59) {
    if (allowanceYocto === null || allowanceYocto === undefined) {
        return {
            reservationYocto: 0n,
            reservationNear: '0',
            cannotClearGateway: true,
            successCalls: 0,
            revertCalls: 0,
            summary: 'cannot clear the gateway'
        };
    }
    const allowance = BigInt(allowanceYocto.toString());
    const gas = BigInt(attachedGasTgas) * 1000000000000n; // Tgas to gas
    const baseReceiptFee = 918880207164400000000n; // 918,880,207,164,400,000,000 yN
    const reservation = gas * 1000000000n + baseReceiptFee; // gas * 1e9 + baseFee
    if (reservation >= allowance) {
        return {
            reservationYocto: reservation,
            reservationNear: formatNear(reservation.toString(), 4),
            cannotClearGateway: true,
            successCalls: 0,
            revertCalls: 0,
            summary: 'cannot clear the gateway'
        };
    }
    const netBurnSuccessGas = BigInt(Math.round(netBurnSuccessTgas * 1000000000000));
    const netBurnRevertGas = BigInt(Math.round(netBurnRevertTgas * 1000000000000));
    const yoctoPerGas = 100000000n; // 1e8
    const remaining = allowance - reservation;
    const successCalls = Number(remaining / (netBurnSuccessGas * yoctoPerGas));
    const revertCalls = Number(remaining / (netBurnRevertGas * yoctoPerGas));
    return {
        reservationYocto: reservation,
        reservationNear: formatNear(reservation.toString(), 4),
        cannotClearGateway: false,
        successCalls,
        revertCalls,
        summary: `About ${successCalls} successful or ${revertCalls} reverted calls at ${attachedGasTgas} Tgas attached (approximate, testnet-measured)`
    };
}
/**
 * Computes security and operational warnings based on on-chain state.
 */
export function computeWarnings(state, balanceYoctoStr, storageUsageBytes, ownerId, allowanceYoctoStr, attachedGasTgas = 30) {
    const warnings = [];
    const balance = BigInt(balanceYoctoStr ? balanceYoctoStr.toString() : '0');
    // Storage cost: (storage_usage + 10000) * 1e19 yoctoNEAR
    const storageCost = (BigInt(storageUsageBytes) + 10000n) * 10000000000000000000n;
    const spendableBalance = balance > storageCost ? balance - storageCost : 0n;
    let maxLoss = spendableBalance;
    if (state && state.period_cap) {
        const periodCap = BigInt(state.period_cap.toString());
        if (periodCap >= spendableBalance) {
            warnings.push({
                code: 'CAP_EXCEEDS_SPENDABLE',
                message: 'Period cap is at or above spendable balance.'
            });
        }
        maxLoss = periodCap < spendableBalance ? periodCap : spendableBalance;
    }
    if (state && ownerId && state.guardian && state.guardian === ownerId) {
        warnings.push({
            code: 'GUARDIAN_EQUALS_OWNER',
            message: 'Guardian equals the NFT owner (no separation of supervisory authority).'
        });
    }
    if (state && state.paused) {
        warnings.push({
            code: 'CONTRACT_PAUSED',
            message: 'Contract is currently paused.'
        });
    }
    if (state && state.has_pending) {
        warnings.push({
            code: 'PENDING_ACTION',
            message: 'A timelocked supervisory action is pending.'
        });
    }
    // Check allowance < 20 * reservation
    const gas = BigInt(attachedGasTgas) * 1000000000000n;
    const baseReceiptFee = 918880207164400000000n;
    const reservation = gas * 1000000000n + baseReceiptFee;
    if (allowanceYoctoStr) {
        const allowance = BigInt(allowanceYoctoStr.toString());
        if (allowance < reservation * 20n) {
            warnings.push({
                code: 'LOW_ALLOWANCE',
                message: 'Allowance is below 20 times the per-call reservation.'
            });
        }
    }
    return {
        spendableBalanceYocto: spendableBalance,
        spendableBalanceNear: formatNear(spendableBalance.toString(), 3),
        maxLossBeforeDetectionYocto: maxLoss,
        maxLossBeforeDetectionNear: formatNear(maxLoss.toString(), 3),
        warnings
    };
}
/**
 * Formats a yoctoNEAR amount into a human-readable NEAR decimal string.
 */
export function formatNear(yoctoStr, decimals = 3) {
    if (!yoctoStr)
        return '0.000';
    try {
        const y = BigInt(yoctoStr.toString());
        const oneNear = 1000000000000000000000000n;
        const whole = y / oneNear;
        const rem = y % oneNear;
        const remPadded = rem.toString().padStart(24, '0');
        return `${whole}.${remPadded.slice(0, decimals)}`;
    }
    catch (_) {
        return '0.000';
    }
}
/**
 * Formats duration in seconds into human-readable compact string.
 */
export function formatDuration(seconds) {
    if (seconds <= 0)
        return '0s';
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0)
        return `${hours}h ${mins}m`;
    if (mins > 0)
        return `${mins}m ${secs}s`;
    return `${secs}s`;
}
/**
 * Formats a countdown based on chain block timestamp rather than local clock.
 */
export function formatChainCountdown(targetTimestampNs, chainBlockTimestampNs) {
    if (!targetTimestampNs || !chainBlockTimestampNs)
        return 'n/a';
    try {
        const target = BigInt(targetTimestampNs.toString());
        const current = BigInt(chainBlockTimestampNs.toString());
        if (target <= current)
            return 'past / ready';
        const diffSec = Number((target - current) / 1000000000n);
        return `in ${formatDuration(diffSec)}`;
    }
    catch (_) {
        return 'n/a';
    }
}
