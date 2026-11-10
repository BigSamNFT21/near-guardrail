import 'dotenv/config';

export const CONFIG = {
  rpcUrl: 'https://test.rpc.fastnear.com',
  contractId: 'guardrail-bigsam.testnet',
  agentId: 'agent-bigsam.testnet',
  agentKey: process.env.AGENT_PRIVATE_KEY,
  anthropicKey: process.env.ANTHROPIC_API_KEY,
  openaiKey: process.env.OPENAI_API_KEY,
  model: process.env.MODEL || (process.env.OPENAI_API_KEY ? 'gpt-4o-mini' : 'claude-haiku-5-5'),
  // Set SCAMCHECK=off to demo the on-chain guardrail catching attacks alone.
  scamCheck: process.env.SCAMCHECK !== 'off',
};
