import fs from 'node:fs';
import 'dotenv/config';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is missing in .env');
  process.exit(1);
}
if (process.env.TELEGRAM_CHAT_ID) {
  console.log('TELEGRAM_CHAT_ID is already set in .env.');
  process.exit(0);
}

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

const me = await api('getMe');
console.log(`Open Telegram, find @${me.username}, press Start and send any message (for example: hi).`);
console.log('Waiting for your message...');

let offset = 0;
while (true) {
  const updates = await api('getUpdates', { offset, timeout: 25, allowed_updates: ['message'] });
  for (const u of updates) {
    offset = u.update_id + 1;
    if (u.message && u.message.chat && u.message.chat.type === 'private') {
      const id = u.message.chat.id;
      fs.appendFileSync('.env', `\nTELEGRAM_CHAT_ID=${id}\n`);
      await api('sendMessage', {
        chat_id: id,
        text: 'Linked. Only this chat can approve or reject payments for the guardrail wallet.',
      });
      console.log('Linked. Saved TELEGRAM_CHAT_ID to .env.');
      process.exit(0);
    }
  }
}
