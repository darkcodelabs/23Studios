'use strict';

const OpenAI = require('openai');

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

async function streamChat({ model, messages, signal, onDelta }) {
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

  const stream = await client().chat.completions.create({
    model,
    messages: safeMessages,
    stream: true
  }, { signal });

  let full = '';
  for await (const part of stream) {
    const delta = part?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta.length > 0) {
      full += delta;
      onDelta(delta);
    }
  }
  return full;
}

module.exports = { listModels, streamChat };
