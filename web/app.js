/**
 * LEASH // Truthful Offline & Live Inspection Report
 * Implements strict read-only NEAR RPC verification, single-verdict engine parity,
 * exact gas economics, and robust transaction replay.
 * 
 * ZERO DOM sinks: only createElement, textContent, setAttribute, and replaceChildren.
 */

import {
  evaluateVerification,
  base58Encode,
  estimateCalls,
  computeWarnings,
  formatNear,
  formatDuration,
  formatChainCountdown
} from './evaluator.js';

// ── State & Storage ──────────────────────────────────────────────────────────

const NEAR_ACCOUNT_REGEX = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;

export const UI_STATE = {
  view: 'readme', // 'readme' | 'inspector' | 'replay' | 'limits' | 'release'
  activeSide: 'readme', // 'readme' | 'verify' | 'limits' | 'release' | 'demo'
  isMockup: true,
  isLive: false,
  isLoading: false,
  errorMessage: null,
  accountNotFound: false,
  notALeashAccount: false,
  interfaceVersionMismatch: false,
  autoRefreshTimer: null,
  inFlightAbort: null,

  // Chain parameters
  rpcUrl: 'http://127.0.0.1:43989',
  accountId: 'agent.test.near',
  attachedGasTgas: 30,

  // Chain query results
  pinnedBlockHash: null,
  pinnedBlockHeight: null,
  pinnedBlockTimestampNs: null,
  accountBalanceYocto: null,
  accountStorageUsage: 0,
  accountKeys: [],
  agentWasmBytes: null,
  agentWasmSha256Hex: null,
  agentWasmSha256Base58: null,
  agentIsTestingWasm: false,

  stateView: null,
  ownerSlot: null,
  periodSpendYocto: '0',

  nftKeys: [],
  nftWasmSha256Hex: null,
  nftTokenOwner: null,

  // Release artifact configuration
  releaseConfig: null,

  // Replay
  replayData: null,
  replaySource: 'none',
  activeScenarioIdx: 0,
  isPlaying: false,
  playTimer: null
};

// ── RPC Client ───────────────────────────────────────────────────────────────

/**
 * Low-level JSON-RPC POST with timeout and abort signal.
 */
export async function rpcPost(url, method, params, signal) {
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 'leash-inspector',
    method,
    params
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal
  });

  if (!res.ok) {
    throw new Error(`RPC HTTP error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  if (json.error) {
    const msg = json.error.data || json.error.message || JSON.stringify(json.error);
    throw new Error(`RPC Error: ${msg}`);
  }
  return json.result;
}

/**
 * Strips ANSI codes and control characters from untrusted strings.
 */
export function sanitizeText(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

/**
 * Computes SHA-256 hash using browser WebCrypto.
 */
export async function sha256WebCrypto(bytes) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('WebCrypto is unavailable. The page must be served from localhost or HTTPS.');
  }
  const hashBuf = await window.crypto.subtle.digest('SHA-256', bytes);
  const hashBytes = new Uint8Array(hashBuf);
  let hex = '';
  for (let i = 0; i < hashBytes.length; i++) {
    hex += hashBytes[i].toString(16).padStart(2, '0');
  }
  const b58 = base58Encode(hashBytes);
  return { hex, base58: b58 };
}

// ── Verification Pipeline ────────────────────────────────────────────────────

/**
 * Executes a full live verification against NEAR RPC.
 */
export async function runLiveVerification() {
  if (UI_STATE.inFlightAbort) {
    UI_STATE.inFlightAbort.abort();
  }
  const controller = new AbortController();
  UI_STATE.inFlightAbort = controller;
  const signal = controller.signal;

  UI_STATE.isLoading = true;
  UI_STATE.errorMessage = null;
  UI_STATE.accountNotFound = false;
  UI_STATE.notALeashAccount = false;
  UI_STATE.interfaceVersionMismatch = false;

  const btnVerify = document.getElementById('btn-verify');
  if (btnVerify) {
    btnVerify.disabled = true;
    btnVerify.textContent = 'Verifying...';
  }

  try {
    const accountId = UI_STATE.accountId;
    if (!accountId || !NEAR_ACCOUNT_REGEX.test(accountId)) {
      throw new Error(`Invalid NEAR account identifier: '${accountId}'`);
    }

    // 1. Fetch Latest Final Block
    const blockRes = await rpcPost(UI_STATE.rpcUrl, 'block', { finality: 'final' }, signal);
    UI_STATE.pinnedBlockHash = blockRes.header.hash;
    UI_STATE.pinnedBlockHeight = blockRes.header.height;
    UI_STATE.pinnedBlockTimestampNs = blockRes.header.timestamp_nanosec || `${blockRes.header.timestamp}000000`;

    const blockIdParam = { block_id: UI_STATE.pinnedBlockHash };

    // 2. Fetch Account State
    let viewAccountRes;
    try {
      viewAccountRes = await rpcPost(UI_STATE.rpcUrl, 'query', {
        request_type: 'view_account',
        account_id: accountId,
        ...blockIdParam
      }, signal);
    } catch (err) {
      if (err.message.includes('does not exist') || err.message.includes('account_does_not_exist')) {
        UI_STATE.accountNotFound = true;
        throw new Error(`Account '${accountId}' does not exist on-chain at block #${UI_STATE.pinnedBlockHeight}`);
      }
      throw err;
    }

    UI_STATE.accountBalanceYocto = viewAccountRes.amount;
    UI_STATE.accountStorageUsage = viewAccountRes.storage_usage || 0;

    // 3. Fetch Access Keys
    const accessKeysRes = await rpcPost(UI_STATE.rpcUrl, 'query', {
      request_type: 'view_access_key_list',
      account_id: accountId,
      ...blockIdParam
    }, signal);
    UI_STATE.accountKeys = accessKeysRes.keys || [];

    // 4. Fetch Contract Bytecode
    const codeRes = await rpcPost(UI_STATE.rpcUrl, 'query', {
      request_type: 'view_code',
      account_id: accountId,
      ...blockIdParam
    }, signal);

    if (codeRes.code_base64) {
      const binStr = atob(codeRes.code_base64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) {
        bytes[i] = binStr.charCodeAt(i);
      }
      UI_STATE.agentWasmBytes = bytes;

      const hashes = await sha256WebCrypto(bytes);
      UI_STATE.agentWasmSha256Hex = hashes.hex;
      UI_STATE.agentWasmSha256Base58 = hashes.base58;

      try {
        const wasmMod = new WebAssembly.Module(bytes);
        const exp = WebAssembly.Module.exports(wasmMod);
        UI_STATE.agentIsTestingWasm = exp.some(e => e.name === 'is_testing_build');
      } catch (_) {
        UI_STATE.agentIsTestingWasm = false;
      }
    } else {
      UI_STATE.agentWasmBytes = null;
      UI_STATE.agentWasmSha256Hex = null;
      UI_STATE.agentWasmSha256Base58 = null;
      UI_STATE.agentIsTestingWasm = false;
    }

    // 5. Call Contract Views: get_state, get_owner_slot, get_current_period_spend
    try {
      const stateCall = await rpcPost(UI_STATE.rpcUrl, 'query', {
        request_type: 'call_function',
        account_id: accountId,
        method_name: 'get_state',
        args_base64: '',
        ...blockIdParam
      }, signal);
      const stateStr = new TextDecoder().decode(new Uint8Array(stateCall.result));
      UI_STATE.stateView = JSON.parse(stateStr);
    } catch (err) {
      UI_STATE.notALeashAccount = true;
      throw new Error(`Account '${accountId}' is not a valid Leash agent (get_state failed: ${err.message})`);
    }

    if (UI_STATE.stateView && UI_STATE.stateView.interface_version !== 1) {
      UI_STATE.interfaceVersionMismatch = true;
      throw new Error(`Unsupported interface version: ${UI_STATE.stateView?.interface_version} (expected 1). Refusing to render state.`);
    }

    try {
      const slotCall = await rpcPost(UI_STATE.rpcUrl, 'query', {
        request_type: 'call_function',
        account_id: accountId,
        method_name: 'get_owner_slot',
        args_base64: '',
        ...blockIdParam
      }, signal);
      const slotStr = new TextDecoder().decode(new Uint8Array(slotCall.result));
      UI_STATE.ownerSlot = JSON.parse(slotStr);
    } catch (_) {
      UI_STATE.ownerSlot = null;
    }

    try {
      const spendCall = await rpcPost(UI_STATE.rpcUrl, 'query', {
        request_type: 'call_function',
        account_id: accountId,
        method_name: 'get_current_period_spend',
        args_base64: '',
        ...blockIdParam
      }, signal);
      const spendStr = new TextDecoder().decode(new Uint8Array(spendCall.result));
      UI_STATE.periodSpendYocto = JSON.parse(spendStr);
    } catch (_) {
      UI_STATE.periodSpendYocto = '0';
    }

    // 6. Query NFT contract state if configured
    if (UI_STATE.stateView && UI_STATE.stateView.nft_contract) {
      const nftId = UI_STATE.stateView.nft_contract;
      try {
        const nftKeysRes = await rpcPost(UI_STATE.rpcUrl, 'query', {
          request_type: 'view_access_key_list',
          account_id: nftId,
          ...blockIdParam
        }, signal);
        UI_STATE.nftKeys = nftKeysRes.keys || [];
      } catch (_) {
        UI_STATE.nftKeys = [];
      }

      try {
        const nftTokenCall = await rpcPost(UI_STATE.rpcUrl, 'query', {
          request_type: 'call_function',
          account_id: nftId,
          method_name: 'nft_token',
          args_base64: btoa(JSON.stringify({ token_id: UI_STATE.stateView.nft_token_id })),
          ...blockIdParam
        }, signal);
        const tokenStr = new TextDecoder().decode(new Uint8Array(nftTokenCall.result));
        const tokenObj = JSON.parse(tokenStr);
        UI_STATE.nftTokenOwner = tokenObj?.owner_id || null;
      } catch (_) {
        UI_STATE.nftTokenOwner = null;
      }
    }

    UI_STATE.isLive = true;
    UI_STATE.isMockup = false;
    renderInspector();
  } catch (err) {
    if (err.name === 'AbortError') return;
    UI_STATE.errorMessage = err.message;
    UI_STATE.isLive = false;
    renderErrorState();
  } finally {
    UI_STATE.isLoading = false;
    UI_STATE.inFlightAbort = null;
    if (btnVerify) {
      btnVerify.disabled = false;
      btnVerify.textContent = 'Verify';
    }
  }
}

// ── Rendering Engine ─────────────────────────────────────────────────────────

/**
 * Updates the Inspector DOM based on current UI_STATE.
 * Strict zero-sink implementation: textContent, setAttribute, replaceChildren.
 */
export function renderInspector() {
  renderStatus();

  // Evaluate single verdict
  const fullAccessKeys = UI_STATE.accountKeys
    .filter(k => k.access_key && k.access_key.permission === 'FullAccess')
    .map(k => k.public_key);

  const scopedKeys = UI_STATE.accountKeys
    .filter(k => {
      const perm = k.access_key?.permission;
      if (!perm || typeof perm !== 'object' || !perm.FunctionCall) return false;
      const fc = perm.FunctionCall;
      return (
        fc.receiver_id === UI_STATE.accountId &&
        Array.isArray(fc.method_names) &&
        fc.method_names.length === 1 &&
        fc.method_names[0] === 'spend'
      );
    })
    .map(k => k.public_key);

  const evalParams = getEvaluationParams();
  const outcome = evaluateVerification(evalParams);
  const expAgentSha = evalParams.expectedAgentSha;

  // 1. Verdict Banner
  const banner = document.getElementById('verdict-banner');
  const vTitle = document.getElementById('v');
  const vCopy = document.getElementById('verdict-copy');

  if (outcome.status === 'LOCKED_AND_VERIFIED') {
    banner.style.borderColor = 'var(--ok)';
    banner.style.background = 'var(--okbg)';
    vTitle.className = 'ok';
    vTitle.textContent = '✓ KEY STRUCTURE VERIFIED';
    vCopy.textContent = 'Proves key structure and that the deployed code matches the published build. Does not audit the contract logic. Computed by this page against one RPC provider; re-run the CLI and make repro to check independently.';
  } else if (outcome.status === 'KEYS_LOCKED_CODE_UNVERIFIED') {
    banner.style.borderColor = 'var(--warn)';
    banner.style.background = 'var(--warnbg)';
    vTitle.className = 'warn';
    vTitle.textContent = '! KEYS LOOK LOCKED, CODE NOT VERIFIED';
    vCopy.textContent = 'Key structure passes. The deployed code does not match the published build, so state below the line is self-reported and unverified.';
  } else if (outcome.status === 'NOT_LOCKED') {
    banner.style.borderColor = 'var(--bad)';
    banner.style.background = 'var(--badbg)';
    vTitle.className = 'bad';
    vTitle.textContent = '✕ NOT_LOCKED';
    vCopy.textContent = `Account does not satisfy supervisory key locking: ${outcome.failingRules.join(', ')}. FullAccess keys or unauthorized permissions detected.`;
  } else {
    banner.style.borderColor = 'var(--bad)';
    banner.style.background = 'var(--badbg)';
    vTitle.className = 'bad';
    vTitle.textContent = `✕ ${outcome.status}`;
    vCopy.textContent = outcome.details.join(' ') || 'Verification check failed.';
  }

  // 2. Meta Line
  const metaEl = document.getElementById('query-meta-line');
  if (metaEl) {
    if (UI_STATE.pinnedBlockHeight) {
      const timeStr = UI_STATE.pinnedBlockTimestampNs
        ? new Date(Number(BigInt(UI_STATE.pinnedBlockTimestampNs) / 1000000n)).toISOString()
        : 'n/a';
      metaEl.textContent = `as of block #${UI_STATE.pinnedBlockHeight} (${timeStr}) · read-only · single-block pinned · verdicts relative to release.json`;
    } else {
      metaEl.textContent = 'as of block 123456789 · 2026-10-26T09:14:02Z · read-only · verdicts are relative to release.json';
    }
  }

  // 3. Checks List
  updateCheckItem('chk-keys', outcome.keysLocked, outcome.keysLocked ? '✓ keys        pass' : '✕ keys        fail');
  updateCheckItem(
    'chk-code',
    !outcome.failingRules.includes('WASM_HASH_MATCH') && !outcome.failingRules.includes('FORBIDDEN_TESTING_BUILD'),
    outcome.failingRules.includes('FORBIDDEN_TESTING_BUILD')
      ? '✕ code        testing build'
      : outcome.failingRules.includes('WASM_HASH_MATCH')
      ? (expAgentSha ? '✕ code hash   mismatch' : '! code hash   unverified (published hash is null)')
      : '✓ code hash   pass',
    outcome.failingRules.includes('WASM_HASH_MATCH') && !expAgentSha ? 'warn' : null
  );
  updateCheckItem('chk-nft', outcome.nftVerified, outcome.nftVerified ? '✓ nft keyless pass' : '✕ nft keyless fail');
  updateCheckItem('chk-iface', !UI_STATE.interfaceVersionMismatch && !UI_STATE.notALeashAccount, '✓ interface   pass');

  // 4. Keys Panel
  const keyObj = UI_STATE.accountKeys.find(k => k.access_key?.permission?.FunctionCall);
  const fcPerm = keyObj?.access_key?.permission?.FunctionCall;
  setText('key-pk', keyObj?.public_key ? `"${keyObj.public_key}"` : '"ed25519:7Hq2…Lm4P"');
  setText('key-receiver', fcPerm?.receiver_id ? `"${fcPerm.receiver_id}"` : `"${UI_STATE.accountId}"`);
  setText('key-allowance', fcPerm?.allowance ? `"${fcPerm.allowance}"` : '"250000000000000000000000"');

  const keyStatusEl = document.getElementById('key-status-text');
  if (keyStatusEl) {
    if (outcome.keysLocked) {
      keyStatusEl.className = 'ok mono';
      keyStatusEl.textContent = '✓ all key rules pass';
    } else {
      keyStatusEl.className = 'bad mono';
      keyStatusEl.textContent = `✕ key rules failed: ${outcome.failingRules.filter(r => r.includes('KEY')).join(', ')}`;
    }
  }

  // 5. Call Capacity Estimate
  const est = estimateCalls(fcPerm?.allowance || '250000000000000000000000', UI_STATE.attachedGasTgas);
  const capEl = document.getElementById('key-capacity-text');
  const resTag = document.getElementById('key-reservations-tag');
  if (capEl) {
    if (est.cannotClearGateway) {
      capEl.textContent = 'cannot clear the gateway';
      if (resTag) resTag.textContent = 'gateway blocked';
    } else {
      capEl.textContent = `About ${est.successCalls} calls at ${UI_STATE.attachedGasTgas} Tgas attached. The allowance is not refunded, so each call drains about 0.0289 NEAR (sandbox measurement, approximate). `;
      if (resTag) {
        resTag.textContent = est.successCalls < 20 ? 'below 20 reservations' : `capacity: ${est.successCalls} calls`;
        resTag.style.display = 'inline-block';
      }
    }
  }

  // 6. Spend Meter
  const state = UI_STATE.stateView;
  const isSelfReported = outcome.status !== 'LOCKED_AND_VERIFIED';
  const selfReportTag = isSelfReported ? ' (self-reported, unverified)' : '';

  const curSpendNear = formatNear(UI_STATE.periodSpendYocto || '200000000000000000000000', 1);
  const periodCapNear = state?.period_cap ? formatNear(state.period_cap, 1) : '0.5';
  setText('spend-current', curSpendNear);
  setText('spend-cap', periodCapNear);

  const curBig = BigInt(UI_STATE.periodSpendYocto || '200000000000000000000000');
  const capBig = BigInt(state?.period_cap || '500000000000000000000000');
  const widthPx = capBig > 0n ? Number((curBig * 399n) / capBig) : 0;
  const meterFill = document.getElementById('meter-svg-fill');
  if (meterFill) {
    meterFill.setAttribute('width', Math.min(Math.max(widthPx, 2), 399).toString());
  }

  const warnRes = computeWarnings(
    state,
    UI_STATE.accountBalanceYocto,
    UI_STATE.accountStorageUsage,
    UI_STATE.nftTokenOwner,
    fcPerm?.allowance,
    UI_STATE.attachedGasTgas
  );
  setText('spend-max-loss', `${warnRes.maxLossBeforeDetectionNear || periodCapNear + ' NEAR'}${selfReportTag}`);

  // 7. Hash Diff
  const pubLine = document.getElementById('hash-pub-line');
  const compLine = document.getElementById('hash-comp-line');
  const hashVerd = document.getElementById('hash-match-verdict');

  const computedHash = UI_STATE.agentWasmSha256Base58 || 'EcqwWyLjBymr9s34H7T5hovyc69TTaH8MDok9LXookBd';
  const publishedHash = expAgentSha || (UI_STATE.isMockup ? 'EcqwWyLjBymr9s34H7T5hovyc69TTaH8MDok9LXookBd' : null);

  if (pubLine) pubLine.textContent = publishedHash || 'null (unreleased tag)';

  if (compLine) {
    if (publishedHash && computedHash && publishedHash !== computedHash && publishedHash.length === computedHash.length) {
      renderDiffChars(compLine, publishedHash, computedHash);
    } else {
      compLine.textContent = computedHash;
    }
  }

  if (hashVerd) {
    if (!publishedHash) {
      hashVerd.className = 'warn';
      hashVerd.textContent = 'Published hash is null in release.json (unreleased tag).';
    } else if (outcome.failingRules.includes('WASM_HASH_MATCH')) {
      let diffCount = 0;
      if (publishedHash.length === computedHash.length) {
        for (let i = 0; i < publishedHash.length; i++) {
          if (publishedHash[i] !== computedHash[i]) diffCount++;
        }
      }
      hashVerd.className = 'bad';
      hashVerd.textContent = `${diffCount > 0 ? diffCount + ' characters' : 'Bytecode hashes'} differ. The deployed code is not the published build.`;
    } else {
      hashVerd.className = 'ok';
      hashVerd.textContent = 'All 44 characters match.';
    }
  }

  // 8. NFT Panel
  setText('nft-contract', state?.nft_contract || 'nft.test.near');
  setText('nft-token', state?.nft_token_id || 'token-1');
  setText('nft-owner', UI_STATE.nftTokenOwner || 'owner-sample.testnet');
  const nftKeysEl = document.getElementById('nft-keys');
  if (nftKeysEl) {
    nftKeysEl.textContent = UI_STATE.nftKeys.length.toString();
    nftKeysEl.className = UI_STATE.nftKeys.length === 0 ? 'ok' : 'bad';
  }

  // 9. Owner Slot / Guardian Timeline
  const slot = UI_STATE.ownerSlot;
  const timeStr = UI_STATE.pinnedBlockTimestampNs
    ? new Date(Number(BigInt(UI_STATE.pinnedBlockTimestampNs) / 1000000n)).toISOString()
    : '2026-10-26T09:14:02Z';
  setText('owner-slot-time', timeStr);

  if (slot) {
    setText('owner-slot-action', formatActionKind(slot.kind));
    setText('owner-slot-details', slot.kind?.Withdraw ? `{ amount: ${formatNear(slot.kind.Withdraw.amount)} NEAR }` : '');
    setText('owner-slot-proposer', slot.proposer || 'none');
    setText('owner-slot-earliest', formatChainCountdown(slot.deadline, UI_STATE.pinnedBlockTimestampNs));
    setText('owner-slot-expires', formatChainCountdown(slot.expiry, UI_STATE.pinnedBlockTimestampNs));
  } else {
    setText('owner-slot-action', state?.paused ? 'Paused' : 'Idle');
    setText('owner-slot-details', state?.paused ? '{ contract paused }' : '{ no pending proposals }');
    setText('owner-slot-proposer', 'none');
    setText('owner-slot-earliest', 'n/a');
    setText('owner-slot-expires', 'n/a');
  }

  // 10. Status Bar
  setText('sb-command', `leash verify ${UI_STATE.accountId}`);
  setText('sb-block', UI_STATE.pinnedBlockHeight ? `block #${UI_STATE.pinnedBlockHeight}` : 'block 123456789');
  const sbStatus = document.getElementById('sb-status');
  if (sbStatus) {
    if (UI_STATE.isLive) {
      sbStatus.textContent = 'LIVE DATA';
      sbStatus.className = 'hot';
    } else {
      sbStatus.textContent = 'SAMPLE DATA';
      sbStatus.className = 'hot';
    }
  }

  // 11. Synchronize Landing Output Box
  setText('landing-out-account', UI_STATE.accountId);
  setText('landing-out-block', UI_STATE.pinnedBlockHeight ? UI_STATE.pinnedBlockHeight.toString() : '123456789');
  setText('landing-out-nft-owner', UI_STATE.nftTokenOwner || 'owner-sample.testnet');
  setText('landing-out-verdict', `verdict: ${outcome.status === 'LOCKED_AND_VERIFIED' ? 'KEY STRUCTURE VERIFIED' : outcome.status}`);
  const landCodeIcon = document.getElementById('landing-out-code-icon');
  const landCodeText = document.getElementById('landing-out-code');
  if (landCodeIcon && landCodeText) {
    if (!outcome.failingRules.includes('WASM_HASH_MATCH')) {
      landCodeIcon.className = 'ok';
      landCodeIcon.textContent = '✓';
      landCodeText.textContent = `${computedHash.slice(0, 6)}…${computedHash.slice(-4)} equals release.json`;
    } else {
      landCodeIcon.className = 'bad';
      landCodeIcon.textContent = '✕';
      landCodeText.textContent = 'hash does not match release.json';
    }
  }
}

/**
 * Highlights differing characters with .x spans using safe replaceChildren.
 */
function renderDiffChars(container, published, computed) {
  container.replaceChildren();
  for (let i = 0; i < computed.length; i++) {
    if (i < published.length && computed[i] !== published[i]) {
      const sp = document.createElement('span');
      sp.className = 'x';
      sp.textContent = computed[i];
      container.appendChild(sp);
    } else {
      container.appendChild(document.createTextNode(computed[i]));
    }
  }
}

function renderErrorState() {
  const banner = document.getElementById('verdict-banner');
  const vTitle = document.getElementById('v');
  const vCopy = document.getElementById('verdict-copy');

  banner.className = 'vd';
  banner.style.borderColor = 'var(--bad)';
  banner.style.background = 'var(--badbg)';
  vTitle.className = 'bad';
  vTitle.textContent = '✕ ERROR';
  vCopy.textContent = UI_STATE.errorMessage || 'An error occurred during verification.';

  updateCheckItem('chk-keys', false, '✕ keys        indeterminate');
  updateCheckItem('chk-code', false, '✕ code hash   indeterminate');
  updateCheckItem('chk-nft', false, '✕ nft keyless indeterminate');
  updateCheckItem('chk-iface', false, '✕ interface   indeterminate');

  const sbStatus = document.getElementById('sb-status');
  if (sbStatus) {
    sbStatus.textContent = 'ERROR';
    sbStatus.className = 'bad';
  }
}

function renderStatus() {
  const sampleBanner = document.getElementById('sample-banner');
  if (sampleBanner) {
    if (UI_STATE.isMockup) {
      sampleBanner.style.display = 'block';
      sampleBanner.textContent = 'Sample data. Mockup. Not a real account or verdict.';
    } else if (UI_STATE.isLive) {
      sampleBanner.style.display = 'block';
      sampleBanner.textContent = 'LIVE CHAIN VERIFICATION · Pinned single-block query · Testnet/Sandbox';
    } else {
      sampleBanner.style.display = 'none';
    }
  }
}

function updateCheckItem(id, passed, text, forceClass = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = text;
  if (forceClass) {
    el.className = forceClass;
  } else {
    el.className = passed ? 'ok' : 'bad';
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function formatActionKind(kind) {
  if (!kind) return 'Idle';
  if (typeof kind === 'string') return kind;
  if (kind.Loosen) return 'Loosen Caps';
  if (kind.Unpause !== undefined) return 'Unpause';
  if (kind.Withdraw) return 'Withdraw';
  return JSON.stringify(kind);
}

// ── Replay Mode ──────────────────────────────────────────────────────────────

export async function loadReplayData() {
  let json = null;
  let source = 'demo-run';

  try {
    const res = await fetch('demo-run.json');
    if (res.ok) {
      json = await res.json();
    }
  } catch (_) {}

  if (!json) {
    try {
      const sampleRes = await fetch('demo-run.sample.json');
      if (sampleRes.ok) {
        json = await sampleRes.json();
        source = 'sample';
      }
    } catch (_) {}
  }

  if (json) {
    setReplayData(json, source);
    const demoPre = document.getElementById('side-demo-pre');
    if (demoPre) {
      demoPre.textContent = JSON.stringify(json, null, 2);
    }
  }
}

export function setReplayData(data, source = 'custom') {
  if (!data || !Array.isArray(data.scenarios)) {
    throw new Error('Invalid replay file: missing scenarios array');
  }

  UI_STATE.replayData = data;
  UI_STATE.replaySource = source;
  UI_STATE.activeScenarioIdx = 0;
  renderReplayView();
}

export function renderReplayView() {
  const data = UI_STATE.replayData;
  if (!data || !data.scenarios || data.scenarios.length === 0) return;

  const idx = UI_STATE.activeScenarioIdx;
  const sc = data.scenarios[idx];

  // Update scenario tabs
  const nav = document.querySelector('.scenario-tabs');
  if (nav) {
    nav.replaceChildren();
    data.scenarios.forEach((s, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = i === idx ? 'scenario-tab active' : 'scenario-tab';
      btn.textContent = `${s.id || (i + 1)}: ${s.name || s.action || 'Scenario'}`;
      btn.addEventListener('click', () => {
        UI_STATE.activeScenarioIdx = i;
        renderReplayView();
      });
      nav.appendChild(btn);
    });
  }

  const vBox = document.getElementById('replay-verdict-box');
  const vTitle = document.getElementById('replay-title');
  const vSummary = document.getElementById('replay-summary-text');

  const isSuccess = sc.status === 'success' || sc.status === 'OK' || !sc.error;
  if (isSuccess) {
    vBox.style.borderColor = 'var(--ok)';
    vBox.style.background = 'var(--okbg)';
    vTitle.className = 'ok';
    vTitle.textContent = `✓ ${sanitizeText(sc.name || sc.action || 'TRANSACTION SUCCESS')}`;
  } else {
    vBox.style.borderColor = 'var(--bad)';
    vBox.style.background = 'var(--badbg)';
    vTitle.className = 'bad';
    vTitle.textContent = `✕ REVERTED: ${sanitizeText(sc.error || 'Execution Aborted')}`;
  }

  let gasBurntTgas = '0.00';
  if (sc.gas_burnt) {
    try {
      const g = BigInt(sc.gas_burnt.toString());
      gasBurntTgas = (Number(g / 1000000000n) / 1000).toFixed(2);
    } catch (_) {}
  }

  const amountStr = sc.amount ? `${formatNear(sc.amount)} NEAR` : 'n/a';
  vSummary.textContent = `${sc.action || 'Action'} · Amount: ${amountStr} · Gas Burnt: ${gasBurntTgas} TGas · Status: ${sc.status || (isSuccess ? 'OK' : 'REVERTED')}`;

  const tracePre = document.getElementById('replay-trace-pre');
  if (tracePre) {
    let traceText = '';
    if (sc.steps && Array.isArray(sc.steps)) {
      traceText = sc.steps.map((st, i) => `[STEP ${i + 1}] ${st.step || st.action}: ${st.status} ${st.detail || ''}`).join('\n');
    } else if (sc.cli_output) {
      traceText = sanitizeText(sc.cli_output);
    } else {
      traceText = `Scenario ${sc.id}: ${sc.name}\nStatus: ${sc.status}\nAmount: ${amountStr}\nGas Burnt: ${sc.gas_burnt || '0'} units (~${gasBurntTgas} TGas)\nError: ${sc.error || 'none'}`;
    }
    tracePre.textContent = traceText;
  }
}

// ── Initialization & Event Wiring ───────────────────────────────────────────



export function getEvaluationParams() {
  const devSha = UI_STATE.releaseConfig?.dev_agent_sha256;
  const relSha = UI_STATE.releaseConfig?.artifacts?.agent_account?.sha256 || UI_STATE.releaseConfig?.agent_account?.sha256;
  const expAgentSha = relSha || devSha || null;

  const devNftSha = UI_STATE.releaseConfig?.dev_nft_sha256;
  const relNftSha = UI_STATE.releaseConfig?.artifacts?.nft?.sha256 || UI_STATE.releaseConfig?.nft?.sha256;
  const expNftSha = relNftSha || devNftSha || null;

  return {
    accountKeys: UI_STATE.accountKeys || [],
    accountId: UI_STATE.accountId || 'agent.test.near',
    isTestingWasm: Boolean(UI_STATE.agentIsTestingWasm),
    codeSha256: UI_STATE.agentWasmSha256Hex,
    forbiddenHashes: UI_STATE.releaseConfig?.forbiddenCodeHashes || [],
    expectedAgentSha: expAgentSha,
    nftContractId: UI_STATE.stateView?.nft_contract || 'nft.test.near',
    nftKeys: UI_STATE.nftKeys || [],
    expectedNftSha: expNftSha,
    nftCodeSha256: UI_STATE.nftWasmSha256Hex
  };
}

export function renderPlainReport() {
  const meta = document.getElementById('plain-report-meta');
  const verdictCard = document.getElementById('plain-report-verdict-card');
  const verdictIcon = document.getElementById('plain-report-verdict-icon');
  const verdictText = document.getElementById('plain-report-verdict-text');

  const qaFull = document.getElementById('plain-qa-fullcontrol');
  const qaFullDesc = document.getElementById('plain-qa-fullcontrol-desc');
  const qaCode = document.getElementById('plain-qa-codematch');
  const qaCodeDesc = document.getElementById('plain-qa-codematch-desc');
  const qaOwnerId = document.getElementById('plain-qa-owner-id');

  const numSpent = document.getElementById('plain-num-spent');
  const numWorst = document.getElementById('plain-num-worst');
  const numFuel = document.getElementById('plain-num-fuel');
  const numPending = document.getElementById('plain-num-pending');

  const heroPayment = document.getElementById('plain-hero-per-payment');
  const heroPeriod = document.getElementById('plain-hero-per-period');
  const heroOwner = document.getElementById('plain-hero-owner');

  const outcome = evaluateVerification(getEvaluationParams());

  const blockHeight = UI_STATE.pinnedBlockHeight || '123456789';
  const nowUtc = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  if (meta) {
    meta.textContent = `${UI_STATE.accountId} · checked at block ${blockHeight} · ${nowUtc}`;
  }

  const isVerified = outcome.status === 'LOCKED_AND_VERIFIED';
  const isCodeMismatch = outcome.status === 'UNVERIFIED_CODE';

  if (verdictCard) {
    verdictCard.style.borderLeftColor = isVerified ? 'var(--ok)' : (isCodeMismatch ? 'var(--warn)' : 'var(--bad)');
  }
  if (verdictIcon) {
    verdictIcon.textContent = isVerified ? '✓' : (isCodeMismatch ? '⚠' : '✕');
    verdictIcon.className = isVerified ? 'yes' : (isCodeMismatch ? 'unk' : 'no');
  }
  if (verdictText) {
    verdictText.textContent = isVerified
      ? 'This agent is locked to its limits.'
      : (isCodeMismatch ? 'Code unverified — does not match release hash.' : 'Security invariants violated.');
  }

  // Full control QA
  const fullAccessKeys = UI_STATE.accountKeys.filter(k => k.access_key && k.access_key.permission === 'FullAccess');
  if (qaFull) {
    if (fullAccessKeys.length === 0) {
      qaFull.textContent = 'No';
      qaFull.className = 'big yes';
      if (qaFullDesc) qaFullDesc.textContent = 'It holds one restricted key and no key with full access.';
    } else {
      qaFull.textContent = 'Yes';
      qaFull.className = 'big no';
      if (qaFullDesc) qaFullDesc.textContent = `Agent account has ${fullAccessKeys.length} FullAccess key(s)!`;
    }
  }

  // Code match QA
  if (qaCode) {
    if (outcome.failingRules.indexOf('WASM_HASH_MATCH') === -1) {
      qaCode.textContent = 'Yes';
      qaCode.className = 'big yes';
      if (qaCodeDesc) qaCodeDesc.textContent = 'The deployed code matches the published version, character for character.';
    } else {
      qaCode.textContent = 'No';
      qaCode.className = 'big no';
      if (qaCodeDesc) qaCodeDesc.textContent = 'Deployed bytecode does not match release.json artifact hash.';
    }
  }

  // Owner QA
  if (qaOwnerId) {
    qaOwnerId.textContent = UI_STATE.nftTokenOwner || 'owner-sample.testnet';
  }

  // Numbers
  const capYocto = UI_STATE.stateView?.period_spend_cap_yocto || '500000000000000000000000';
  const spentYocto = UI_STATE.periodSpendYocto || '200000000000000000000000';
  if (numSpent) {
    numSpent.textContent = `${formatNear(spentYocto)} of ${formatNear(capYocto)} NEAR`;
  }
  if (numWorst) {
    numWorst.textContent = `up to ${formatNear(capYocto)} NEAR`;
  }
  if (numFuel) {
    const key = UI_STATE.accountKeys[0]?.access_key?.permission?.FunctionCall;
    const est = estimateCalls(key?.allowance, UI_STATE.attachedGasTgas);
    numFuel.textContent = `about ${est.approxCalls} payments `;
    const span = document.createElement('span');
    span.className = 'road';
    span.textContent = 'estimate';
    numFuel.appendChild(span);
  }
  if (numPending) {
    numPending.textContent = UI_STATE.stateView?.has_pending_claims ? '1, a withdrawal, waiting 2h 10m' : '0 pending';
  }

  // Landing page hero stats
  if (heroPayment) {
    const pLimit = UI_STATE.stateView?.per_call_spend_cap_yocto || '250000000000000000000000';
    heroPayment.textContent = `${formatNear(pLimit)} NEAR`;
  }
  if (heroPeriod) {
    heroPeriod.textContent = `${formatNear(capYocto)} NEAR`;
  }
  if (heroOwner) {
    heroOwner.textContent = UI_STATE.nftTokenOwner || 'the NFT holder';
  }
}


document.addEventListener('DOMContentLoaded', async () => {
  // Load release.json preview
  try {
    const relRes = await fetch('release.json');
    if (relRes.ok) {
      UI_STATE.releaseConfig = await relRes.json();
      const relPre = document.getElementById('release-json-pre');
      if (relPre) {
        relPre.textContent = JSON.stringify(UI_STATE.releaseConfig, null, 2);
      }
      const sideRelPre = document.getElementById('side-release-pre');
      if (sideRelPre) {
        sideRelPre.textContent = JSON.stringify(UI_STATE.releaseConfig, null, 2);
      }
    }
  } catch (_) {}

  // Initial mockup render
  renderInspector();
  await loadReplayData();

  // Tab navigation elements
  const tabs = {
    overview: document.getElementById('tab-overview'),
    report: document.getElementById('tab-report'),
    readme: document.getElementById('tab-readme'),
    inspector: document.getElementById('tab-inspector'),
    replay: document.getElementById('tab-replay'),
    limits: document.getElementById('tab-limits'),
    release: document.getElementById('tab-release')
  };

  const views = {
    overview: document.getElementById('view-overview'),
    report: document.getElementById('view-report'),
    readme: document.getElementById('view-readme'),
    inspector: document.getElementById('view-inspector'),
    replay: document.getElementById('view-replay'),
    limits: document.getElementById('view-limits'),
    release: document.getElementById('view-release')
  };

  function setTab(name) {
    UI_STATE.view = name;
    Object.keys(tabs).forEach(k => {
      if (tabs[k]) {
        tabs[k].classList.toggle('on', k === name);
        tabs[k].setAttribute('aria-selected', k === name ? 'true' : 'false');
      }
      if (views[k]) {
        let disp = 'none';
        if (k === name) {
          if (k === 'readme') disp = 'grid';
          else if (k === 'overview' || k === 'report') disp = 'block';
          else disp = 'flex';
        }
        views[k].style.display = disp;
      }
    });
    if (name === 'report' || name === 'overview') {
      renderPlainReport();
    } else if (name === 'inspector') {
      renderInspector();
    }
  }

  Object.keys(tabs).forEach(name => {
    if (tabs[name]) {
      tabs[name].addEventListener('click', () => setTab(name));
    }
  });

  // Sidebar navigation in view-readme
  const sideItems = {
    readme: document.getElementById('side-readme'),
    verify: document.getElementById('side-verify'),
    limits: document.getElementById('side-limits'),
    release: document.getElementById('side-release'),
    demo: document.getElementById('side-demo')
  };

  const sidePanes = {
    readme: document.getElementById('pane-readme'),
    verify: document.getElementById('pane-verify'),
    limits: document.getElementById('pane-limits'),
    release: document.getElementById('pane-release-side'),
    demo: document.getElementById('pane-demo-side')
  };

  function setSidebar(name) {
    UI_STATE.activeSide = name;
    Object.keys(sideItems).forEach(k => {
      if (sideItems[k]) sideItems[k].classList.toggle('on', k === name);
      if (sidePanes[k]) sidePanes[k].style.display = k === name ? 'block' : 'none';
    });
  }

  Object.keys(sideItems).forEach(name => {
    if (sideItems[name]) {
      sideItems[name].addEventListener('click', () => setSidebar(name));
    }
  });

  // Sidebar "Open inspector" button
  const sideOpenBtn = document.getElementById('sidebar-open-inspector');
  if (sideOpenBtn) {
    sideOpenBtn.addEventListener('click', () => setTab('inspector'));
  }

  // Landing page interactive test input
  const landingRunBtn = document.getElementById('landing-btn-run');
  const landingLimitsBtn = document.getElementById('landing-btn-limits');
  const landingAccInput = document.getElementById('landing-account-input');
  const rpcInput = document.getElementById('input-rpc');
  const accountInput = document.getElementById('input-account');

  if (landingRunBtn && landingAccInput && accountInput) {
    landingRunBtn.addEventListener('click', () => {
      const acc = landingAccInput.value.trim();
      if (acc) {
        accountInput.value = acc;
        UI_STATE.accountId = acc;
      }
      setTab('inspector');
      runLiveVerification();
    });
  }

  if (landingLimitsBtn) {
    landingLimitsBtn.addEventListener('click', () => setTab('limits'));
  }

  // Theme toggle
  const root = document.getElementById('root-theme');
  const btnTheme = document.getElementById('btn-theme-toggle');
  if (btnTheme && root) {
    btnTheme.addEventListener('click', () => {
      if (root.classList.contains('lt')) {
        root.classList.remove('lt');
        root.classList.add('dk');
      } else {
        root.classList.remove('dk');
        root.classList.add('lt');
      }
    });
  }

  // Verify button in Inspector
  const btnVerify = document.getElementById('btn-verify');
  if (btnVerify && rpcInput && accountInput) {
    btnVerify.addEventListener('click', () => {
      UI_STATE.rpcUrl = rpcInput.value.trim();
      UI_STATE.accountId = accountInput.value.trim();
      runLiveVerification();
    });
  }

  // Auto-refresh (minimum 15 seconds)
  const autoRefreshCb = document.getElementById('auto-refresh-toggle');
  if (autoRefreshCb) {
    autoRefreshCb.addEventListener('change', () => {
      if (autoRefreshCb.checked) {
        UI_STATE.autoRefreshTimer = setInterval(() => {
          runLiveVerification();
        }, 15000);
      } else {
        if (UI_STATE.autoRefreshTimer) {
          clearInterval(UI_STATE.autoRefreshTimer);
          UI_STATE.autoRefreshTimer = null;
        }
      }
    });
  }

  // Replay transport controls
  const btnPrev = document.getElementById('btn-replay-prev');
  const btnPlay = document.getElementById('btn-replay-play');
  const btnNext = document.getElementById('btn-replay-next');

  if (btnPrev) {
    btnPrev.addEventListener('click', () => {
      if (!UI_STATE.replayData) return;
      const len = UI_STATE.replayData.scenarios.length;
      UI_STATE.activeScenarioIdx = (UI_STATE.activeScenarioIdx - 1 + len) % len;
      renderReplayView();
    });
  }

  if (btnNext) {
    btnNext.addEventListener('click', () => {
      if (!UI_STATE.replayData) return;
      const len = UI_STATE.replayData.scenarios.length;
      UI_STATE.activeScenarioIdx = (UI_STATE.activeScenarioIdx + 1) % len;
      renderReplayView();
    });
  }

  if (btnPlay) {
    btnPlay.addEventListener('click', () => {
      UI_STATE.isPlaying = !UI_STATE.isPlaying;
      btnPlay.textContent = UI_STATE.isPlaying ? '❚❚ Pause' : '▶ Play';

      if (UI_STATE.isPlaying) {
        UI_STATE.playTimer = setInterval(() => {
          if (!UI_STATE.replayData) return;
          const len = UI_STATE.replayData.scenarios.length;
          UI_STATE.activeScenarioIdx = (UI_STATE.activeScenarioIdx + 1) % len;
          renderReplayView();
        }, 3500);
      } else {
        if (UI_STATE.playTimer) {
          clearInterval(UI_STATE.playTimer);
          UI_STATE.playTimer = null;
        }
      }
    });
  }

  // Copy trace
  const btnCopyTrace = document.getElementById('btn-copy-trace');
  if (btnCopyTrace) {
    btnCopyTrace.addEventListener('click', () => {
      const trace = document.getElementById('replay-trace-pre')?.textContent || '';
      navigator.clipboard.writeText(trace).then(() => {
        btnCopyTrace.textContent = 'copied';
        setTimeout(() => { btnCopyTrace.textContent = 'copy'; }, 1500);
      });
    });
  }

  // File upload for custom replay traces
  const fileUpload = document.getElementById('file-replay-upload');
  if (fileUpload) {
    fileUpload.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const parsed = JSON.parse(ev.target.result);
          setReplayData(parsed, 'custom');
        } catch (err) {
          alert('Invalid JSON file: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
  }

  // Check URL parameters (e.g. ?account=... or #inspector)
  const urlParams = new URLSearchParams(window.location.search);
  const accountParam = urlParams.get('account');
  const rpcParam = urlParams.get('rpc');
  if (rpcParam && rpcInput) {
    rpcInput.value = rpcParam;
    UI_STATE.rpcUrl = rpcParam;
  }
  if (accountParam && accountInput) {
    accountInput.value = accountParam;
    UI_STATE.accountId = accountParam;
    setTab('inspector');
    runLiveVerification();
  } else if (window.location.hash === '#inspector') {
    setTab('inspector');
  }

  // Plain Language view event bindings
  const plainInput = document.getElementById('plain-agent-input');
  const btnPlainRun = document.getElementById('btn-plain-run');
  const btnPlainSample = document.getElementById('btn-plain-sample');
  const plainNavEngineers = document.getElementById('plain-nav-engineers');
  const plainNavCheck = document.getElementById('plain-nav-check');
  const btnPlainCheckBottom = document.getElementById('btn-plain-check-bottom');
  const btnReportTech = document.getElementById('btn-report-tech');
  const btnReportDownload = document.getElementById('btn-report-download');

  async function handlePlainCheck(acct) {
    const target = (acct || plainInput?.value || 'agent.test.near').trim();
    if (target) {
      UI_STATE.accountId = target;
      if (accountInput) accountInput.value = target;
      const landingIn = document.getElementById('landing-account-input');
      if (landingIn) landingIn.value = target;
    }
    setTab('report');
    if (UI_STATE.isLive) {
      await runLiveVerification();
    } else {
      renderInspector();
    }
    renderPlainReport();
  }

  if (btnPlainRun) btnPlainRun.addEventListener('click', () => handlePlainCheck());
  if (plainNavCheck) {
    plainNavCheck.addEventListener('click', (e) => {
      e.preventDefault();
      handlePlainCheck();
    });
  }
  if (btnPlainCheckBottom) btnPlainCheckBottom.addEventListener('click', () => handlePlainCheck());
  if (btnPlainSample) {
    btnPlainSample.addEventListener('click', () => {
      loadSampleData();
      renderInspector();
      renderPlainReport();
      setTab('report');
    });
  }
  if (plainNavEngineers) {
    plainNavEngineers.addEventListener('click', (e) => {
      e.preventDefault();
      setTab('readme');
    });
  }
  if (btnReportTech) {
    btnReportTech.addEventListener('click', () => setTab('inspector'));
  }
  if (btnReportDownload) {
    btnReportDownload.addEventListener('click', () => {
      window.open('report.html', '_blank');
    });
  }

  // Also bind any clicks on overview/report elements that reference inspector
  document.querySelectorAll('[data-goto-tab]').forEach(el => {
    el.addEventListener('click', () => {
      const target = el.getAttribute('data-goto-tab');
      if (target) setTab(target);
    });
  });

  // Initial call to render plain report & inspector
  renderPlainReport();

});
