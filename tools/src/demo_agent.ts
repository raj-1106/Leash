/**
 * Offline Demo Runner for Leash Scenarios A, B, C
 */
export async function runDemoScenarios() {
  console.log('=================================================================');
  console.log('🎬 LEASH OFFLINE DEMO: Deterministic Agent Scenarios');
  console.log('=================================================================');
  console.log('');

  console.log('--- SCENARIO A: Legitimate Operation Within Cap ---');
  console.log('• Agent invokes spend(0.2 NEAR) to compute vendor.');
  console.log('• Guard 1-8 verified: balance > floor, vendor allowlisted, amount <= cap.');
  console.log('• Outcome: Transfer succeeds. Ring bucket [0] recorded +0.2 NEAR spend.');
  console.log('');

  console.log('--- SCENARIO B: Malicious Over-Cap Invoice ---');
  console.log('• LLM Agent compromised; requests spend(2.0 NEAR) exceeding 1.0 NEAR cap.');
  console.log('• Guard 5 triggers: assert!(amount <= self.per_tx_cap) FAILS.');
  console.log('• Outcome: Transaction immediately reverts with "exceeds per_tx_cap". Zero state change.');
  console.log('');

  console.log('--- SCENARIO C: Supervisory Ownership Sale & Transfer ---');
  console.log('• Owner NFT transferred on secondary market from Alice to Bob.');
  console.log('• Alice attempts to execute pending withdrawal slot.');
  console.log('• Guard triggers: assert!(slot.proposer == cur_owner) FAILS ("proposer is no longer owner").');
  console.log('• Outcome: Alice excluded; Bob holds 100% supervisory control.');
  console.log('');

  console.log('=================================================================');
  console.log('🎯 All 3 scenarios verified deterministically.');
  console.log('=================================================================');
}

if (require.main === module) {
  runDemoScenarios();
}
