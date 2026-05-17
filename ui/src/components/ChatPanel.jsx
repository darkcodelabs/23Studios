import { useCallback, useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { Send, Loader2, AlertCircle } from 'lucide-react';
import ChatMessage from './ChatMessage.jsx';
import { openChat, send as wsSend } from '../lib/ws.js';
import { getCsrfToken } from '../lib/api.js';

const CLAUDE = { id: 'claude', label: 'Claude (via Claude Code)' };

export default function ChatPanel({ project, model }) {
  const activeBackend = !model || model.id === CLAUDE.id ? 'claude' : 'openrouter';
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [err, setErr] = useState(null);
  const wsRef = useRef(null);
  const streamingIdxRef = useRef(-1);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (activeBackend !== 'claude') {
      if (wsRef.current) { try { wsRef.current.close(); } catch (_e) {} }
      wsRef.current = null;
      setWsReady(false);
      return;
    }

    const ws = openChat({
      onOpen: () => wsSend(ws, { type: 'start', project_id: project.id }),
      onMessage: (m) => {
        if (m.type === 'ready') { setWsReady(true); return; }
        if (m.type === 'history') {
          setMessages((m.items || []).map((h) => ({
            role: h.role, content: h.content || '',
            backend: h.backend, model: h.model
          })));
          return;
        }
        if (m.type === 'chunk') {
          setMessages((prev) => {
            const i = streamingIdxRef.current;
            if (i < 0 || i >= prev.length) return prev;
            const copy = prev.slice();
            copy[i] = { ...copy[i], content: (copy[i].content || '') + (m.text || '') };
            return copy;
          });
          return;
        }
        if (m.type === 'done') {
          setStreaming(false);
          streamingIdxRef.current = -1;
          return;
        }
        if (m.type === 'error') {
          setStreaming(false);
          streamingIdxRef.current = -1;
          setErr(m.message || 'chat_failed');
          return;
        }
      },
      onClose: () => setWsReady(false),
      onError: () => setErr('connection lost')
    });
    wsRef.current = ws;
    return () => { try { ws.close(); } catch (_e) {} };
  }, [project.id, activeBackend]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, streaming]);

  const sendClaude = useCallback((text) => {
    if (!wsReady || !wsRef.current) return false;
    setStreaming(true);
    setErr(null);
    setMessages((prev) => {
      const next = [...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '', backend: 'claude' }
      ];
      streamingIdxRef.current = next.length - 1;
      return next;
    });
    return wsSend(wsRef.current, { type: 'message', text });
  }, [wsReady]);

  const sendOpenRouter = useCallback(async (text) => {
    setStreaming(true);
    setErr(null);
    let assistantIdx = -1;
    setMessages((prev) => {
      const next = [...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: '', backend: 'openrouter', model: model.id }
      ];
      assistantIdx = next.length - 1;
      return next;
    });

    const history = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }));
    const payload = {
      model: model.id,
      project_id: project.id,
      messages: [...history, { role: 'user', content: text }]
    };
    try {
      const appBase = (typeof window !== 'undefined' && window.__APP_BASE__) || '';
      const res = await fetch(`${appBase}/api/openrouter/chat`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-csrf-token': getCsrfToken() || ''
        },
        body: JSON.stringify(payload)
      });
      if (!res.ok || !res.body) {
        setErr('openrouter request failed');
        setStreaming(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = 'message';
          let dataLine = '';
          for (const ln of block.split('\n')) {
            if (ln.startsWith('event:')) event = ln.slice(6).trim();
            else if (ln.startsWith('data:')) dataLine += ln.slice(5).trim();
          }
          if (!dataLine) continue;
          let data;
          try { data = JSON.parse(dataLine); } catch (_e) { continue; }
          if (event === 'chunk' && data.text) {
            setMessages((prev) => {
              const copy = prev.slice();
              if (assistantIdx >= 0 && assistantIdx < copy.length) {
                copy[assistantIdx] = { ...copy[assistantIdx], content: (copy[assistantIdx].content || '') + data.text };
              }
              return copy;
            });
          } else if (event === 'error') {
            setErr(data.message || 'stream_failed');
          }
        }
      }
    } catch (_e) {
      setErr('openrouter request failed');
    } finally {
      setStreaming(false);
    }
  }, [messages, model, project.id]);

  function onSubmit(e) {
    e?.preventDefault?.();
    if (streaming) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    if (activeBackend === 'claude') sendClaude(text);
    else sendOpenRouter(text);
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-ink-500 text-sm text-center py-12">
            chat is empty. messages route to {activeBackend === 'claude' ? 'Claude Code' : (model?.label || model?.id)}.
          </div>
        ) : (
          messages.map((m, i) => (
            <ChatMessage
              key={i}
              role={m.role}
              content={m.content}
              backend={m.backend}
              model={m.model}
              streaming={streaming && i === messages.length - 1 && m.role === 'assistant'}
            />
          ))
        )}
      </div>

      {err ? (
        <div className="px-4 py-2 border-t border-red-900/50 bg-red-950/20 text-red-300 text-xs flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5" /> {err}
        </div>
      ) : null}

      <form onSubmit={onSubmit} className="border-t border-ink-700 bg-ink-900/40 p-3 flex items-end gap-2">
        <TextareaAutosize
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={activeBackend === 'claude' && !wsReady ? 'connecting…' : `message ${activeBackend === 'claude' ? 'Claude Code' : (model?.label || model?.id)}`}
          minRows={1}
          maxRows={8}
          maxLength={10000}
          disabled={streaming || (activeBackend === 'claude' && !wsReady)}
          className="input font-mono resize-none"
        />
        <button type="submit" className="btn-primary" disabled={streaming || !input.trim() || (activeBackend === 'claude' && !wsReady)}>
          {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
