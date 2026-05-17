'use strict';

// PulpScript tokenizer.
// Hand-written, no deps. Returns a flat token list plus any lexer errors.
//
// Token shape: { type, value, line, col }
//
// Token types:
//   IDENT, NUMBER, STRING, KEYWORD,
//   OP (one of: = == != < <= > >= + - * / % += -= *= /= ++ --),
//   COMMA, COLON, NEWLINE, EOF.
//
// Keywords (lowercase, case-insensitive in source):
//   on, do, end, if, then, elseif, else, while, done,
//   tell, to, call, emit, mimic, in, at, option, true, false.
//
// Comments: // to end of line. Block comments are not in the spec.

const KEYWORDS = new Set([
  'on', 'do', 'end', 'if', 'then', 'elseif', 'else', 'while', 'done',
  'tell', 'to', 'call', 'emit', 'mimic', 'in', 'at', 'option',
  'true', 'false',
]);

function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}
function isIdentCont(ch) {
  return isIdentStart(ch) || isDigit(ch) || ch === '.';
}

function tokenize(source) {
  const tokens = [];
  const errors = [];
  const src = String(source == null ? '' : source);
  const len = src.length;

  let i = 0;
  let line = 1;
  let col = 1;

  function push(type, value, startLine, startCol) {
    tokens.push({ type, value, line: startLine, col: startCol });
  }

  function err(msg, l, c) {
    errors.push({ line: l, col: c, message: msg });
  }

  while (i < len) {
    const ch = src[i];

    // Newlines are significant (statement terminators).
    if (ch === '\n') {
      push('NEWLINE', '\n', line, col);
      i++; line++; col = 1;
      continue;
    }
    if (ch === '\r') {
      // swallow; if followed by \n the \n will produce NEWLINE.
      i++;
      if (src[i] !== '\n') {
        push('NEWLINE', '\n', line, col);
        line++; col = 1;
      }
      continue;
    }

    // Whitespace (not newline).
    if (ch === ' ' || ch === '\t') { i++; col++; continue; }

    // Line comment.
    if (ch === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') { i++; col++; }
      continue;
    }

    // String literal — double-quoted, supports \" \\ \n \t \f.
    if (ch === '"') {
      const startLine = line, startCol = col;
      i++; col++;
      let buf = '';
      let closed = false;
      while (i < len) {
        const c = src[i];
        if (c === '"') { i++; col++; closed = true; break; }
        if (c === '\\' && i + 1 < len) {
          const n = src[i + 1];
          if (n === 'n') buf += '\n';
          else if (n === 't') buf += '\t';
          else if (n === 'r') buf += '\r';
          else if (n === 'f') buf += '\f';
          else if (n === '"') buf += '"';
          else if (n === '\\') buf += '\\';
          else buf += n;
          i += 2; col += 2;
          continue;
        }
        if (c === '\n') {
          // Unterminated string on this line; bail.
          err('unterminated string literal', startLine, startCol);
          closed = true;
          break;
        }
        buf += c;
        i++; col++;
      }
      if (!closed) err('unterminated string literal', startLine, startCol);
      push('STRING', buf, startLine, startCol);
      continue;
    }

    // Number literal — integer or decimal. Leading - handled as OP.
    if (isDigit(ch)) {
      const startLine = line, startCol = col;
      let buf = '';
      while (i < len && isDigit(src[i])) { buf += src[i]; i++; col++; }
      if (src[i] === '.' && isDigit(src[i + 1])) {
        buf += '.'; i++; col++;
        while (i < len && isDigit(src[i])) { buf += src[i]; i++; col++; }
      }
      push('NUMBER', Number(buf), startLine, startCol);
      continue;
    }

    // Identifier / keyword. `.` allowed mid-ident so we can read `event.dx` etc.
    if (isIdentStart(ch)) {
      const startLine = line, startCol = col;
      let buf = '';
      while (i < len && isIdentCont(src[i])) { buf += src[i]; i++; col++; }
      const lower = buf.toLowerCase();
      if (KEYWORDS.has(lower)) {
        push('KEYWORD', lower, startLine, startCol);
      } else {
        push('IDENT', buf, startLine, startCol);
      }
      continue;
    }

    // Two-char operators.
    const two = src.substr(i, 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' ||
        two === '+=' || two === '-=' || two === '*=' || two === '/=' ||
        two === '++' || two === '--') {
      push('OP', two, line, col);
      i += 2; col += 2;
      continue;
    }

    // Single-char ops + punctuation.
    if (ch === '=' || ch === '<' || ch === '>' ||
        ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      push('OP', ch, line, col);
      i++; col++;
      continue;
    }
    if (ch === ',') { push('COMMA', ',', line, col); i++; col++; continue; }
    if (ch === ':') { push('COLON', ':', line, col); i++; col++; continue; }
    if (ch === '(' || ch === ')') {
      // PulpScript doesn't really use parens for call syntax, but tolerate them.
      push(ch === '(' ? 'LPAREN' : 'RPAREN', ch, line, col);
      i++; col++; continue;
    }

    // Unknown char.
    err(`unexpected character '${ch}'`, line, col);
    i++; col++;
  }

  push('EOF', null, line, col);
  return { tokens, errors };
}

module.exports = { tokenize, KEYWORDS };
