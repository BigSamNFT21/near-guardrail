import { Account, JsonRpcProvider, teraToGas } from 'near-api-js';
import { CONFIG } from './config.mjs';

const provider = new JsonRpcProvider({ url: CONFIG.rpcUrl });
const agent = CONFIG.agentKey
  ? new Account(CONFIG.agentId, provider, CONFIG.agentKey)
  : null;

const YOCTO = 10n ** 24n;

export function toYocto(nearStr) {
  const m = String(nearStr).trim().match(/^(\d+)(?:\.(\d{1,24}))?$/);
  if (!m) throw new Error(`Invalid NEAR amount: ${nearStr}`);
  return (BigInt(m[1]) * YOCTO + BigInt((m[2] || '').padEnd(24, '0'))).toString();
}

export function fromYocto(yocto) {
  const b = BigInt(yocto);
  const whole = b / YOCTO;
  const frac = (b % YOCTO).toString().padStart(24, '0').slice(0, 4).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

// near-api-js may hand back either the parsed return value or the full
// execution outcome; handle both.
function unwrap(result) {
  if (result && typeof result.status === 'object' && result.status !== null) {
    if (result.status.Failure) throw new Error(JSON.stringify(result.status.Failure));
    if (result.status.SuccessValue !== undefined) {
      const raw = Buffer.from(result.status.SuccessValue, 'base64').toString();
      return raw ? JSON.parse(raw) : null;
    }
  }
  return result;
}

async function call(methodName, args) {
  if (!agent) throw new Error('AGENT_PRIVATE_KEY missing in .env (run: npm run genkey)');
  const result = await agent.callFunction({
    contractId: CONFIG.contractId,
    methodName,
    args,
    gas: teraToGas('30'),
    deposit: 0n,
  });
  return unwrap(result);
}

export const requestPayment = (recipient, amountYocto, memo) =>
  call('request_payment', { recipient, amount: amountYocto, memo });

export const logBlock = (recipient, amountYocto, memo, reason) =>
  call('log_block', { recipient, amount: amountYocto, memo, reason });

export const getLog = (from = 0, limit = 100) =>
  provider.callFunction({
    contractId: CONFIG.contractId,
    method: 'get_log',
    args: { from_index: from, limit },
  });

export const getPolicy = () =>
  provider.callFunction({
    contractId: CONFIG.contractId,
    method: 'get_policy',
    args: {},
  });
