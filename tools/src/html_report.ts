import { VerificationResult } from './verifier';

/**
 * Generates a self-contained HTML verification report for a specific block height.
 * Requires ZERO runtime JavaScript; purely semantic HTML + inlined CSS design system.
 */
export function generateVerificationHtml(res: VerificationResult): string {
  const isVerified = res.status === 'LOCKED_AND_VERIFIED';
  const isWarn = res.status === 'KEYS_LOCKED_CODE_UNVERIFIED';

  const verdictClass = isVerified ? 'ok' : isWarn ? 'warn' : 'bad';
  const verdictBg = isVerified ? 'var(--okbg)' : isWarn ? 'var(--warnbg)' : 'var(--badbg)';
  const verdictBorder = isVerified ? 'var(--ok)' : isWarn ? 'var(--warn)' : 'var(--bad)';

  let verdictHeading = '';
  let verdictCopy = '';

  if (isVerified) {
    verdictHeading = '✓ KEY STRUCTURE VERIFIED';
    verdictCopy = 'Proves key structure and that the deployed code matches the published build. Does not audit contract logic.';
  } else if (isWarn) {
    verdictHeading = '! KEYS LOOK LOCKED, CODE NOT VERIFIED';
    verdictCopy = 'Key structure satisfies locking invariants, but deployed bytecode does not match published release hash.';
  } else {
    verdictHeading = `✕ ${res.status}`;
    verdictCopy = res.details && res.details.length > 0 ? res.details.join(' ') : 'Supervisory locking invariants failed.';
  }

  const failingListHtml = res.failingRules && res.failingRules.length > 0
    ? res.failingRules.map(r => `<div class="l"><i>!</i><span class="bad">${escapeHtml(r)}</span></div>`).join('\n')
    : '<div class="l"><i>✓</i><span class="ok">zero failing rules</span></div>';

  const detailsListHtml = res.details && res.details.length > 0
    ? res.details.map(d => `<div class="l"><i>•</i><span>${escapeHtml(d)}</span></div>`).join('\n')
    : '<div class="l"><i>•</i><span class="mu">no discrepancies recorded</span></div>';

  const blockText = res.blockHeight ? `block #${res.blockHeight} (${res.blockHash || ''})` : 'unpinned';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Leash Verification Report: ${escapeHtml(res.accountId)}</title>
  <style>
    :root {
      --bg: #FAFAFA;
      --pn: #EFEFEF;
      --ln: #111111;
      --ink: #0A0A0A;
      --mu: #555555;
      --ac: #FF5A1F;
      --actx: #0A0A0A;
      --cm: #5F5F5F;
      --ok: #0A7A3D;
      --bad: #B00020;
      --warn: #7A5200;
      --okbg: #E1F2E8;
      --badbg: #FBE3E6;
      --warnbg: #F8EEC8;
    }
    * { box-sizing: border-box; margin: 0; }
    body {
      background: var(--bg);
      color: var(--ink);
      font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.6;
      padding: 32px 20px;
    }
    .container { max-width: 900px; margin: 0 auto; display: flex; flex-direction: column; gap: 24px; }
    .mono { font-family: 'IBM Plex Mono', 'Geist Mono', ui-monospace, Menlo, Consolas, monospace; }
    .st {
      background: var(--ink);
      color: var(--bg);
      padding: 8px 16px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: .1em;
      text-align: center;
      text-transform: uppercase;
    }
    .hero-line { font-size: 13px; color: var(--mu); }
    .title { font-size: 32px; font-weight: 600; letter-spacing: -.03em; margin: 4px 0 0; }
    .vd {
      border: 1px solid ${verdictBorder};
      border-left-width: 8px;
      background: ${verdictBg};
      padding: 18px 20px;
    }
    .vd b { font: 600 24px 'IBM Plex Mono', monospace; color: var(--${verdictClass}); }
    .vd p { margin: 8px 0 0; max-width: 70ch; }
    .pn { border: 1.5px solid var(--ln); background: var(--bg); }
    .pt { background: var(--pn); border-bottom: 1px solid var(--ln); padding: 8px 16px; font: 500 12px 'IBM Plex Mono', monospace; color: var(--mu); letter-spacing: .04em; }
    .pb { padding: 16px; }
    .cd { font-size: 13px; line-height: 1.75; background: var(--pn); border: 1.5px solid var(--ln); padding: 12px 0; overflow-x: auto; }
    .l { display: flex; gap: 16px; padding: 0 16px; white-space: pre; }
    .l i { color: var(--cm); font-style: normal; text-align: right; min-width: 2.2ch; user-select: none; }
    .ok { color: var(--ok); }
    .bad { color: var(--bad); }
    .warn { color: var(--warn); }
    .mu { color: var(--mu); }
    .add { background: var(--okbg); color: var(--ok); }
    .del { background: var(--badbg); color: var(--bad); }
    .g { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
    .sb { display: flex; gap: 20px; flex-wrap: wrap; background: var(--ink); color: var(--bg); padding: 8px 16px; font-size: 12px; }
    .hot { background: var(--ac); color: var(--actx); padding: 0 8px; font-weight: 600; }
  </style>
</head>
<body>
<div class="container">
  <div class="st mono">Verification Report · Generated at ${escapeHtml(blockText)} by leash · Re-run to check</div>

  <div>
    <div class="mono hero-line"># leash · verification report</div>
    <h1 class="title mono">${escapeHtml(res.accountId)}</h1>
    <p class="mono mu" style="margin-top:6px;font-size:12px">Pinned at ${escapeHtml(blockText)} · relative to release.json</p>
  </div>

  <section class="vd" aria-label="Verification Verdict">
    <b>${verdictHeading}</b>
    <p>${escapeHtml(verdictCopy)}</p>
  </section>

  <section class="pn">
    <div class="pt">▾ checks.out</div>
    <div class="pb">
      <div class="cd mono">
        <div class="l"><i>1</i><span><span class="${res.keysLocked ? 'ok' : 'bad'}">${res.keysLocked ? '✓' : '✕'} keys</span>         ${res.keysLocked ? 'pass (0 FullAccess, 1 scoped spend key)' : 'fail'}</span></div>
        <div class="l"><i>2</i><span><span class="${!res.failingRules.includes('WASM_HASH_MATCH') ? 'ok' : 'bad'}">${!res.failingRules.includes('WASM_HASH_MATCH') ? '✓' : '✕'} code hash</span>    ${res.codeSha256 || 'null'}</span></div>
        <div class="l"><i>3</i><span><span class="${res.nftVerified ? 'ok' : 'bad'}">${res.nftVerified ? '✓' : '✕'} nft keyless</span>  ${res.nftVerified ? 'pass (zero access keys)' : 'fail'}</span></div>
      </div>
    </div>
  </section>

  <div class="g">
    <section class="pn">
      <div class="pt">▾ failing.rules</div>
      <div class="pb">
        <div class="cd mono">
          ${failingListHtml}
        </div>
      </div>
    </section>

    <section class="pn">
      <div class="pt">▾ notes &amp; discrepancies</div>
      <div class="pb">
        <div class="cd mono">
          ${detailsListHtml}
        </div>
      </div>
    </section>
  </div>

  <section class="pn">
    <div class="pt">▾ claims.diff</div>
    <div class="pb">
      <div class="cd mono">
        <div class="l"><i>1</i><span><span class="add">+ key structure at the pinned block</span></span></div>
        <div class="l"><i>2</i><span><span class="add">+ deployed wasm equals the published build</span></span></div>
        <div class="l"><i>3</i><span><span class="del">- the contract logic is safe</span></span></div>
        <div class="l"><i>4</i><span><span class="del">- the RPC is honest</span></span></div>
        <div class="l"><i>5</i><span><span class="del">- release.json is authentic</span></span></div>
      </div>
    </div>
  </section>

  <footer class="sb mono">
    <span>leash verify ${escapeHtml(res.accountId)}</span>
    <span>${escapeHtml(blockText)}</span>
    <span class="hot">VERIFICATION REPORT</span>
  </footer>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

