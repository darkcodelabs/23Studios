'use strict';

const OpenAI = require('openai');

// Lazy-required to break a circular: openrouter_spend pulls `./openrouter`
// for pricing fallback. Loading it inside streamChat keeps the cycle
// resolvable.
let _spend = null;
function spend() {
  if (_spend) return _spend;
  try { _spend = require('./openrouter_spend'); }
  catch (_e) { _spend = { recordCall: async () => null }; }
  return _spend;
}

const BASE_URL = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';
const API_KEY = process.env.OPENROUTER_API_KEY || '';

let _client = null;
function client() {
  if (_client) return _client;
  if (!API_KEY) throw new Error('OPENROUTER_API_KEY not set');
  _client = new OpenAI({
    baseURL: BASE_URL,
    apiKey: API_KEY,
    defaultHeaders: {
      'HTTP-Referer': 'http://127.0.0.1',
      'X-Title': '23 Studios'
    }
  });
  return _client;
}

let modelsCache = { ts: 0, data: null };
const MODELS_TTL = 60 * 60 * 1000;

async function listModels() {
  if (modelsCache.data && Date.now() - modelsCache.ts < MODELS_TTL) {
    return modelsCache.data;
  }
  if (!API_KEY) return [];
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${API_KEY}` }
  });
  if (!res.ok) throw new Error(`openrouter models ${res.status}`);
  const body = await res.json();
  const list = (body.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    context_length: m.context_length || null,
    pricing: m.pricing || null
  }));
  modelsCache = { ts: Date.now(), data: list };
  return list;
}

async function streamChat({ model, messages, signal, onDelta, projectId, stage, sceneId }) {
  if (typeof model !== 'string' || model.length === 0 || model.length > 200) {
    throw new Error('invalid model');
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error('invalid messages');
  }
  const safeMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : (m.role === 'system' ? 'system' : 'user'),
    content: String(m.content || '').slice(0, 200000)
  }));

  // Stream the response and ask OpenRouter to include usage in the final
  // chunk; it's the only way to get prompt/completion token counts for a
  // streaming chat call. The shape lands in part.usage on the last chunk.
  const stream = await client().chat.completions.create({
    model,
    messages: safeMessages,
    stream: true,
    stream_options: { include_usage: true }
  }, { signal });

  let full = '';
  let usage = null;
  for await (const part of stream) {
    const delta = part?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      full += delta;
      onDelta(delta);
    }
    if (part && part.usage) usage = part.usage;
  }

  // Best-effort spend record. recordCall is a no-op when projectId is
  // falsy or the project can't be resolved, so anonymous/system chats
  // (e.g. internal pipeline calls) silently skip logging instead of
  // failing the stream.
  if (projectId) {
    try {
      await spend().recordCall({
        projectId,
        model,
        stage: stage || 'chat',
        scene_id: sceneId || null,
        kind: 'chat',
        prompt_tokens: usage && usage.prompt_tokens,
        completion_tokens: usage && usage.completion_tokens
      });
    } catch (_e) { /* logging is best-effort */ }
  }
  return full;
}

module.exports = { listModels, streamChat };
