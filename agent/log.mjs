// Read-only: prints the live on-chain audit log. No keys or .env needed.
import { CONFIG } from './config.mjs';
import { fromYocto, getLog, getPolicy } from './chain.mjs';

const limit = Number(process.argv[2]) || 100;
const policy = await getPolicy();
const log = await getLog(0, 1000);
const shown = log.slice(-limit);

const counts = log.reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {});

console.log(`Guardrail vault: ${CONFIG.contractId} (NEAR testnet)`);
console.log(
  `Policy: max ${fromYocto(policy.per_tx_cap)} NEAR per payment | ${fromYocto(policy.daily_cap)} NEAR per day | owner approval above ${fromYocto(policy.approval_threshold)} NEAR | kill switch: ${policy.paused ? 'ON' : 'off'}`
);
console.log(`Spent today: ${fromYocto(policy.spent_today)} NEAR`);
console.log(`Audit log: ${log.length} entries`, counts, '\n');

for (const e of shown) {
  const id = `#${e.id}`.padEnd(5);
  const status = String(e.status).toUpperCase().padEnd(9);
  const amount = `${fromYocto(e.amount)} NEAR`.padEnd(12);
  const to = String(e.recipient).padEnd(28);
  console.log(`${id}${status}${amount}-> ${to} ${e.reason}`);
}
console.log(`\nExplorer: https://explorer.testnet.near.org/accounts/${CONFIG.contractId}`);
