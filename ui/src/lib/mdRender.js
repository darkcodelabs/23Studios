// Tiny, dependency-free markdown -> React-safe HTML renderer.
//
// Covers what canon docs actually need (headings, paragraphs, bold/italic,
// inline + fenced code, bullet/numbered lists, hr, blockquotes). We do NOT
// pull in react-markdown because adding a new UI dep belongs in a separate
// PR — this renderer is intentionally minimal and HTML-escape-first.
//
// Each top-level heading is given a stable `id` derived from the spec's
// slug rule so the TOC links work as anchor jumps.

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slug(title) {
  return String(title).toLowerCase()
    .replace(/[^a-z0-9\s§-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// Inline transforms: **bold**, *italic*, `code`. Applied AFTER escaping.
function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1 rounded text-xs">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');
  // Links: [text](url) — escape both halves.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) =>
    `<a href="${esc(u)}" class="text-sky-300 underline hover:text-sky-200" target="_blank" rel="noopener">${t}</a>`);
  return out;
}

export function renderMarkdownToHtml(md) {
  if (!md) return '';
  const lines = String(md).split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Comment line — skip silently (canon version banner uses HTML comments).
    if (/^\s*<!--/.test(line) && /-->\s*$/.test(line)) { i++; continue; }

    // Fenced code block ```lang ... ```
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = esc(fence[1] || '');
      i++;
      const body = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(esc(lines[i])); i++;
      }
      if (i < lines.length) i++; // consume closing fence
      out.push(`<pre class="bg-zinc-900 border border-zinc-800 rounded p-3 overflow-auto text-xs" data-lang="${lang}"><code>${body.join('\n')}</code></pre>`);
      continue;
    }

    // Headings #..######
    const h = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = slug(text);
      const sizes = ['text-3xl', 'text-2xl', 'text-xl', 'text-lg', 'text-base', 'text-sm'];
      out.push(`<h${level} id="${id}" class="font-semibold ${sizes[level - 1]} mt-6 mb-2 scroll-mt-20">${inline(text)}</h${level}>`);
      i++; continue;
    }

    // Horizontal rule
    if (/^(\*\s*){3,}$|^(-\s*){3,}$|^(_\s*){3,}$/.test(line.trim())) {
      out.push('<hr class="border-zinc-800 my-4" />');
      i++; continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, '')); i++;
      }
      out.push(`<blockquote class="border-l-2 border-zinc-700 pl-3 text-zinc-300 my-3">${inline(body.join(' '))}</blockquote>`);
      continue;
    }

    // Bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++;
      }
      out.push(`<ul class="list-disc list-inside space-y-1 my-2">${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ul>`);
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, '')); i++;
      }
      out.push(`<ol class="list-decimal list-inside space-y-1 my-2">${items.map((t) => `<li>${inline(t)}</li>`).join('')}</ol>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) { i++; continue; }

    // Paragraph: gather consecutive non-empty, non-special lines.
    const para = [];
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]); i++;
    }
    out.push(`<p class="my-2 leading-relaxed text-zinc-200">${inline(para.join(' '))}</p>`);
  }
  return out.join('\n');
}
