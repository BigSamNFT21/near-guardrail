import fs from 'node:fs';
import { KeyPair } from 'near-api-js';
import { CONFIG } from './config.mjs';

if (fs.existsSync('.env') && fs.readFileSync('.env', 'utf8').includes('AGENT_PRIVATE_KEY=')) {
  console.log('AGENT_PRIVATE_KEY already exists in .env, not generating a new one.');
  process.exit(0);
}

const keyPair = KeyPair.fromRandom('ed25519');
fs.appendFileSync('.env', `\nAGENT_PRIVATE_KEY=${keyPair.toString()}\n`);
const publicKey = keyPair.getPublicKey().toString();

console.log('New agent key saved to .env (private key never printed).');
console.log('\nThis key can ONLY call request_payment and log_block on the guardrail contract.');
console.log('Run this command to authorize it:\n');
console.log(
  `near account add-key ${CONFIG.agentId} grant-function-call-access --allowance '1 NEAR' --contract-account-id ${CONFIG.contractId} --function-names 'request_payment,log_block' use-manually-provided-public-key ${publicKey} network-config testnet sign-with-keychain send`
);
