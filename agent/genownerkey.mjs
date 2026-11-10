import fs from 'node:fs';
import { KeyPair } from 'near-api-js';
import { CONFIG } from './config.mjs';

const OWNER = 'owner-bigsam.testnet';

if (fs.existsSync('.env') && fs.readFileSync('.env', 'utf8').includes('OWNER_APPROVER_KEY=')) {
  console.log('OWNER_APPROVER_KEY already exists in .env, not generating a new one.');
  process.exit(0);
}

const keyPair = KeyPair.fromRandom('ed25519');
fs.appendFileSync('.env', `\nOWNER_APPROVER_KEY=${keyPair.toString()}\n`);
const publicKey = keyPair.getPublicKey().toString();

console.log('New approver key saved to .env (private key never printed).');
console.log('\nThis key can ONLY call approve, reject, pause and resume on the guardrail contract.');
console.log('It cannot change the allowlist, caps, or agents, and cannot transfer funds.');
console.log('Run this command to authorize it:\n');
console.log(
  `near account add-key ${OWNER} grant-function-call-access --allowance '1 NEAR' --contract-account-id ${CONFIG.contractId} --function-names 'approve,reject,pause,resume' use-manually-provided-public-key ${publicKey} network-config testnet sign-with-keychain send`
);
