import { Account, JsonRpcProvider, teraToGas } from 'near-api-js';
import { CONFIG } from './config.mjs';
import { fromYocto } from './chain.mjs';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT = process.env.TELEGRAM_CHAT_ID;
const KEY = process.env.OWNER_APPROVER_KEY;
const OWNER = 'owner-bigsam.testnet';

if (!TOKEN || !CHAT || !KEY) {
  console.error('Missing TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID or OWNER_APPROVER_KEY in .env');
  process.exit(1);
}

const provider = new JsonRpcProvider({ url: CONFIG.rpcUrl });
const owner = new Account(OWNER, provider, KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, body = {}) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
};
const send = (text, extra = {}) => api('sendMessage', { chat_id: CHAT, text, ...extra });
const view = (method, args = {}) =>
  provider.callFunction({ contractId: CONFIG.contractId, method, args });

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

async function ownerCall(methodName, args = {}) {
  const r = await owner.callFunction({
    contractId: CONFIG.contractId,
    methodName,
    args,
    gas: teraToGas('30'),
    deposit: 0n,
  });
  return unwrap(r);
}

const fmt = (e) =>
  `${e.amount ? fromYocto(e.amount) : '?'} NEAR -> ${e.recipient}\nmemo: ${e.memo}\nagent: ${e.agent}\nreason: ${e.reason}`;

// ---- chain -> Telegram notifications ----

const notified = new Set();
let seenLog = null;

async function checkChain() {
  const pending = await view('get_pending');
  for (const e of pending) {
    if (notified.has(e.id)) continue;
    notified.add(e.id);
    await send(`⏳ Approval needed (#${e.id})\n${fmt(e)}`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Approve', callback_data: `a:${e.id}` },
          { text: '❌ Reject', callback_data: `r:${e.id}` },
        ]],
      },
    });
  }

  if (seenLog === null) {
    seenLog = (await view('get_log', { from_index: 0, limit: 5000 })).length;
    return;
  }
  const fresh = await view('get_log', { from_index: seenLog, limit: 100 });
  for (const e of fresh) {
    seenLog = e.id + 1;
    if (e.status === 'blocked') await send(`🛑 BLOCKED (#${e.id})\n${fmt(e)}`);
    else if (e.status === 'paid') await send(`✅ PAID (#${e.id})\n${fmt(e)}`);
  }
}

// ---- Telegram -> chain actions ----

async function onCallback(q) {
  if (String(q.message.chat.id) !== String(CHAT)) return;
  const [kind, idStr] = String(q.data).split(':');
  const id = Number(idStr);
  await api('answerCallbackQuery', { callback_query_id: q.id, text: 'Sending to NEAR...' });
  const base = { chat_id: CHAT, message_id: q.message.message_id };
  try {
    if (kind === 'a') {
      const e = await ownerCall('approve', { id });
      await api('editMessageText', { ...base, text: `✅ You approved #${id}. Status: ${e.status} (${e.reason})\n${fmt(e)}` });
    } else if (kind === 'r') {
      const e = await ownerCall('reject', { id });
      await api('editMessageText', { ...base, text: `❌ You rejected #${id}. Status: ${e.status}\n${fmt(e)}` });
    }
  } catch (err) {
    await api('editMessageText', { ...base, text: `Could not complete #${id}: ${err.message.slice(0, 300)}` });
  }
}

async function onMessage(m) {
  if (String(m.chat.id) !== String(CHAT)) return;
  const text = (m.text || '').trim().toLowerCase();
  if (text === '/status') {
    const p = await view('get_policy');
    await send(
      `Guardrail status\npaused: ${p.paused}\nper payment cap: ${fromYocto(p.per_tx_cap)} NEAR\ndaily cap: ${fromYocto(p.daily_cap)} NEAR\nspent today: ${fromYocto(p.spent_today)} NEAR\napproval above: ${fromYocto(p.approval_threshold)} NEAR`
    );
  } else if (text === '/pause') {
    await ownerCall('pause');
    await send('🚨 Kill switch ON. All agent payments are halted.');
  } else if (text === '/resume') {
    await ownerCall('resume');
    await send('Kill switch OFF. The agent can pay again within policy.');
  } else {
    await send('Commands: /status, /pause (kill switch), /resume');
  }
}

// ---- loops ----

async function updatesLoop() {
  let offset = 0;
  while (true) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 20, allowed_updates: ['message', 'callback_query'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        if (u.callback_query) await onCallback(u.callback_query);
        else if (u.message) await onMessage(u.message);
      }
    } catch (e) {
      console.error('telegram loop:', e.message);
      await sleep(3000);
    }
  }
}

async function chainLoop() {
  while (true) {
    try {
      await checkChain();
    } catch (e) {
      console.error('chain loop:', e.message);
    }
    await sleep(5000);
  }
}

console.log(`Approval bot running for ${CONFIG.contractId}. Press Ctrl+C to stop.`);
await send('🛡️ Guardrail approval bot online. Commands: /status, /pause, /resume');
updatesLoop();
chainLoop();
