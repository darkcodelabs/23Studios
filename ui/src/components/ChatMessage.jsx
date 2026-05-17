import { Bot, User } from 'lucide-react';

export default function ChatMessage({ role, content, backend, model, streaming }) {
  const isUser = role === 'user';
  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser ? (
        <div className="w-7 h-7 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center shrink-0">
          <Bot className="w-3.5 h-3.5 text-accent" />
        </div>
      ) : null}
      <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm font-mono whitespace-pre-wrap break-words ${
        isUser ? 'bg-accent text-ink-900' : 'bg-ink-800 text-ink-100 border border-ink-700'
      }`}>
        {content}
        {streaming ? <span className="inline-block w-1.5 h-3 ml-1 bg-current animate-pulse align-middle" /> : null}
        {!isUser && (backend || model) ? (
          <div className="mt-1 text-[10px] text-ink-500">
            {backend || ''}{model ? ` · ${model}` : ''}
          </div>
        ) : null}
      </div>
      {isUser ? (
        <div className="w-7 h-7 rounded-full bg-ink-800 border border-ink-700 flex items-center justify-center shrink-0">
          <User className="w-3.5 h-3.5 text-ink-300" />
        </div>
      ) : null}
    </div>
  );
}
