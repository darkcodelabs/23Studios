import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Loader2, RefreshCw, FileText } from 'lucide-react';
import Nav from '../components/Nav.jsx';
import { api } from '../lib/api.js';

// Architecture page — renders architecture.md with Mermaid diagram support.
// Route: /project/:id/architecture

// ---------------------------------------------------------------------------
// Markdown renderer — lightweight, no external dep beyond mermaid itself.
// Converts the specific subset the arch generator emits:
//   - # headings
//   - > blockquotes
//   - ```mermaid fenced blocks → <pre class="mermaid">
//   - | tables |
//   - - list items
//   - _italic_ inline
// ---------------------------------------------------------------------------

function renderMd(raw) {
  if (!raw) return [];

  const lines = raw.split('\n');
  const elements = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block (mermaid or plain).
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      const codeText = codeLines.join('\n');
      if (lang === 'mermaid') {
        elements.push(
          <pre key={key++} className="mermaid bg-ink-900 rounded-md p-3 overflow-x-auto text-xs text-ink-300">
            {codeText}
          </pre>
        );
      } else {
        elements.push(
          <pre key={key++} className="bg-ink-900 rounded-md p-3 overflow-x-auto text-xs text-ink-300">
            {codeText}
          </pre>
        );
      }
      continue;
    }

    // H1
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={key++} className="text-xl font-semibold text-ink-100 mt-6 mb-2">
          {line.slice(2)}
        </h1>
      );
      i++;
      continue;
    }

    // H2
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key++} className="text-base font-semibold text-ink-200 mt-5 mb-1.5 border-b border-ink-800 pb-1">
          {line.slice(3)}
        </h2>
      );
      i++;
      continue;
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={key++} className="text-sm font-semibold text-ink-300 mt-4 mb-1">
          {line.slice(4)}
        </h3>
      );
      i++;
      continue;
    }

    // Blockquote.
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={key++} className="border-l-2 border-ink-600 pl-3 py-1 text-[12px] text-ink-400 italic my-2">
          {line.slice(2)}
        </blockquote>
      );
      i++;
      continue;
    }

    // Table — collect contiguous | lines.
    if (line.startsWith('|')) {
      const tableLines = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const [headerRow, _sep, ...bodyRows] = tableLines;
      const parseCells = (r) =>
        r.split('|').slice(1, -1).map((c) => c.trim());

      const headers = parseCells(headerRow || '');
      elements.push(
        <div key={key++} className="overflow-x-auto my-3">
          <table className="min-w-full text-[12px] border border-ink-800 rounded-md overflow-hidden">
            <thead>
              <tr className="bg-ink-800">
                {headers.map((h, hi) => (
                  <th key={hi} className="px-3 py-1.5 text-left text-ink-300 font-medium border-b border-ink-700">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-ink-950' : 'bg-ink-900'}>
                  {parseCells(row).map((cell, ci) => (
                    <td key={ci} className="px-3 py-1.5 text-ink-400 border-b border-ink-800 font-mono">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // List item.
    if (line.startsWith('- ')) {
      const items = [];
      while (i < lines.length && lines[i].startsWith('- ')) {
        items.push(lines[i].slice(2));
        i++;
      }
      elements.push(
        <ul key={key++} className="list-disc list-inside space-y-0.5 text-[13px] text-ink-400 my-2 pl-2">
          {items.map((item, ii) => <li key={ii}>{renderInline(item)}</li>)}
        </ul>
      );
      continue;
    }

    // Empty line.
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph.
    elements.push(
      <p key={key++} className="text-[13px] text-ink-400 my-1.5">
        {renderInline(line)}
      </p>
    );
    i++;
  }

  return elements;
}

// Render inline markdown: _italic_ and `code`.
function renderInline(text) {
  // Split on backtick code spans and italic.
  const parts = text.split(/(`[^`]+`|_[^_]+_)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="font-mono text-[11px] bg-ink-800 px-1 py-0.5 rounded text-ink-200">{part.slice(1, -1)}</code>;
    }
    if (part.startsWith('_') && part.endsWith('_')) {
      return <em key={i} className="text-ink-400 italic">{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function Architecture() {
  const { id: projectId } = useParams();
  const [md, setMd] = useState(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [err, setErr] = useState(null);
  const mermaidRef = useRef(null);
  const mermaidInitialized = useRef(false);

  const loadArch = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await api.get(`/api/projects/${projectId}/architecture`);
      setMd(r.md || null);
    } catch (e) {
      if (e && e.status === 404) setMd(null);
      else setErr(e.message || 'failed to load architecture');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { loadArch(); }, [loadArch]);

  // Initialize mermaid and run it whenever md changes.
  useEffect(() => {
    if (!md) return;

    import('mermaid').then((mod) => {
      const mermaid = mod.default;
      if (!mermaidInitialized.current) {
        mermaid.initialize({ startOnLoad: false, theme: 'dark' });
        mermaidInitialized.current = true;
      }
      // Re-run after React has painted the .mermaid pre blocks.
      requestAnimationFrame(() => {
        mermaid.run().catch(() => { /* ignore render errors */ });
      });
    }).catch(() => { /* mermaid unavailable */ });
  }, [md]);

  async function handleGenerate() {
    setGenerating(true);
    setErr(null);
    try {
      await api.post(`/api/projects/${projectId}/architecture/generate`, {});
      await loadArch();
    } catch (e) {
      if (e && e.error === 'no_compiled_design') {
        setErr('No compiled_design.json found. Run the design compiler first.');
      } else {
        setErr((e && (e.detail || e.message)) || 'generation failed');
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="h-screen flex flex-col bg-ink-950 text-ink-100">
      <Nav subtitle="architecture" />

      <div className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-4xl mx-auto px-4 py-6 space-y-4" ref={mermaidRef}>

          {/* Header */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-semibold text-ink-100">Architecture Diagram</h1>
              <p className="text-[12px] text-ink-500 mt-0.5">
                Auto-generated from compiled_design.json + Lua source tree.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generating}
              className="btn btn-primary flex items-center gap-2 text-sm"
            >
              {generating
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : <RefreshCw className="w-3.5 h-3.5" />}
              {generating ? 'Generating…' : 'Regenerate'}
            </button>
          </div>

          {/* Error banner */}
          {err && (
            <div className="rounded-md bg-red-900/30 border border-red-700 px-3 py-2.5 text-sm text-red-300">
              {err}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-2 text-sm text-ink-500">
              <Loader2 className="w-4 h-4 animate-spin" /> loading…
            </div>
          )}

          {/* Not generated yet */}
          {!loading && !md && !err && (
            <div className="rounded-md bg-ink-900 border border-ink-800 px-4 py-6 text-center space-y-2">
              <FileText className="w-8 h-8 text-ink-600 mx-auto" />
              <p className="text-sm text-ink-400">No architecture diagram yet.</p>
              <p className="text-[12px] text-ink-600">
                Click &quot;Regenerate&quot; above — requires compiled_design.json.
              </p>
            </div>
          )}

          {/* Rendered markdown */}
          {md && (
            <div className="rounded-md bg-ink-900 border border-ink-800 px-5 py-5 space-y-1 prose-custom">
              {renderMd(md)}
            </div>
          )}

          {/* Back link */}
          <div className="pt-2">
            <Link
              to={`/project/${projectId}/ship`}
              className="text-[12px] text-ink-500 hover:text-ink-300 transition-colors"
            >
              back to ship status
            </Link>
          </div>

        </div>
      </div>
    </div>
  );
}
