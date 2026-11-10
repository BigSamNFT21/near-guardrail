// Off-chain first line of defense. Cheap, deterministic, explainable.
// Even if this is bypassed, the contract still enforces caps and the allowlist.

const HARD_RULES = [
  [/ignore\s+(all\s+|any\s+)?(previous|prior|above|earlier)\s+(instructions|rules|messages)/i,
    'prompt injection: tries to override the agent instructions'],
  [/(disregard|forget|override|bypass|circumvent)\b.{0,50}\b(rules|polic(y|ies)|limits?|instructions|guardrails?|caps?)/i,
    'prompt injection: tries to bypass spending rules'],
  [/(admin|developer|system|root)\s+mode|you\s+are\s+now\b|new\s+instructions\s*:/i,
    'prompt injection: tries to change the agent role'],
  [/\b(send|transfer|move|drain|empty|withdraw)\b.{0,30}\b(all|everything|entire|whole|full balance)\b/i,
    'asks to move all funds'],
  [/(do\s*not|don'?t)\s+(tell|notify|alert|inform)\b.{0,30}\b(owner|admin|human|anyone)/i,
    'asks to hide the payment from the owner'],
];

const SOFT_RULES = [
  [/\b(urgent|urgently|immediately|right now|asap|within minutes)\b/i, 'pressure: urgency language'],
  [/\b(secret|confidential|off the books|between us)\b/i, 'pressure: secrecy language'],
  [/\b(new|changed|updated)\s+(wallet|address|account)\b/i, 'payment details recently changed'],
];

export function checkTask(text) {
  const hard = HARD_RULES.filter(([re]) => re.test(text)).map(([, why]) => why);
  const soft = SOFT_RULES.filter(([re]) => re.test(text)).map(([, why]) => why);
  const flagged = hard.length > 0 || soft.length >= 2;
  return { flagged, reasons: [...hard, ...soft] };
}
