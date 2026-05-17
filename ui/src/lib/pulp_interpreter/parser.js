// Browser-side port of server/services/pulp_transpiler/{tokenizer,parser}.js.
// Pure ES module so the interpreter can consume the same AST shape the
// transpiler does, without pulling in any Node-only code.
//
// Token / AST shapes match the server module exactly so anything documented
// in pulp_transpiler/parser.js applies here too. See the top of that file
// for the node-type cheat sheet.

const KEYWORDS = new Set([
  'on', 'do', 'end', 'if', 'then', 'elseif', 'else', 'while', 'done',
  'tell', 'to', 'call', 'emit', 'mimic', 'in', 'at', 'option',
  'true', 'false',
]);

const COMMAND_NAMES = new Set([
  'say', 'ask', 'menu', 'fin',
  'goto', 'swap', 'play', 'wait', 'shake',
  'call', 'emit', 'mimic', 'act',
  'draw', 'hide', 'window', 'label', 'fill', 'crop',
  'listen', 'ignore',
  'sound', 'once', 'loop', 'stop', 'bpm',
  'store', 'restore', 'toss',
  'frame', 'log', 'dump',
  'solid', 'type', 'id', 'name', 'invert',
  'random', 'floor', 'ceil', 'round',
  'sine', 'cosine', 'tangent', 'radians', 'degrees',
]);

const BLOCK_COMMANDS = new Set([
  'say', 'ask', 'menu', 'play', 'once', 'wait', 'shake',
]);

const OPTION_BLOCK_COMMANDS = new Set(['ask', 'menu']);

function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isIdentStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}
function isIdentCont(ch) {
  return isIdentStart(ch) || isDigit(ch) || ch === '.';
}

export function tokenize(source) {
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

    if (ch === '\n') {
      push('NEWLINE', '\n', line, col);
      i++; line++; col = 1;
      continue;
    }
    if (ch === '\r') {
      i++;
      if (src[i] !== '\n') {
        push('NEWLINE', '\n', line, col);
        line++; col = 1;
      }
      continue;
    }
    if (ch === ' ' || ch === '\t') { i++; col++; continue; }

    if (ch === '/' && src[i + 1] === '/') {
      while (i < len && src[i] !== '\n') { i++; col++; }
      continue;
    }

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

    if (isIdentStart(ch)) {
      const startLine = line, startCol = col;
      let buf = '';
      while (i < len && isIdentCont(src[i])) { buf += src[i]; i++; col++; }
      const lower = buf.toLowerCase();
      if (KEYWORDS.has(lower)) push('KEYWORD', lower, startLine, startCol);
      else push('IDENT', buf, startLine, startCol);
      continue;
    }

    const two = src.substr(i, 2);
    if (two === '==' || two === '!=' || two === '<=' || two === '>=' ||
        two === '+=' || two === '-=' || two === '*=' || two === '/=' ||
        two === '++' || two === '--') {
      push('OP', two, line, col);
      i += 2; col += 2;
      continue;
    }

    if (ch === '=' || ch === '<' || ch === '>' ||
        ch === '+' || ch === '-' || ch === '*' || ch === '/' || ch === '%') {
      push('OP', ch, line, col);
      i++; col++;
      continue;
    }
    if (ch === ',') { push('COMMA', ',', line, col); i++; col++; continue; }
    if (ch === ':') { push('COLON', ':', line, col); i++; col++; continue; }
    if (ch === '(' || ch === ')') {
      push(ch === '(' ? 'LPAREN' : 'RPAREN', ch, line, col);
      i++; col++; continue;
    }

    err(`unexpected character '${ch}'`, line, col);
    i++; col++;
  }

  push('EOF', null, line, col);
  return { tokens, errors };
}

export function parse(source) {
  const { tokens, errors: lexErrors } = tokenize(source);
  const errors = lexErrors.slice();

  let pos = 0;
  function peek(offset = 0) { return tokens[pos + offset]; }
  function consume() { return tokens[pos++]; }
  function eof() { return peek().type === 'EOF'; }

  function err(msg, tok) {
    const t = tok || peek();
    errors.push({ line: t.line, col: t.col, message: msg });
  }

  function skipNewlines() {
    while (peek().type === 'NEWLINE') pos++;
  }

  function recoverToLineEnd() {
    while (!eof() && peek().type !== 'NEWLINE') pos++;
    if (peek().type === 'NEWLINE') pos++;
  }

  function expectKeyword(kw) {
    const t = peek();
    if (t.type === 'KEYWORD' && t.value === kw) { pos++; return t; }
    err(`expected '${kw}'`, t);
    return null;
  }

  function parseExpression() { return parseComparison(); }

  function parseComparison() {
    let left = parseAdditive();
    while (true) {
      const t = peek();
      if (t.type === 'OP' && (t.value === '==' || t.value === '!=' ||
          t.value === '<' || t.value === '<=' || t.value === '>' || t.value === '>=')) {
        consume();
        const right = parseAdditive();
        left = { type: 'Binary', op: t.value, left, right, line: t.line, col: t.col };
      } else break;
    }
    return left;
  }

  function parseAdditive() {
    let left = parseMultiplicative();
    while (true) {
      const t = peek();
      if (t.type === 'OP' && (t.value === '+' || t.value === '-')) {
        consume();
        const right = parseMultiplicative();
        left = { type: 'Binary', op: t.value, left, right, line: t.line, col: t.col };
      } else break;
    }
    return left;
  }

  function parseMultiplicative() {
    let left = parseUnary();
    while (true) {
      const t = peek();
      if (t.type === 'OP' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        consume();
        const right = parseUnary();
        left = { type: 'Binary', op: t.value, left, right, line: t.line, col: t.col };
      } else break;
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t.type === 'OP' && t.value === '-') {
      consume();
      const operand = parseUnary();
      return { type: 'Unary', op: '-', operand, line: t.line, col: t.col };
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = peek();
    if (t.type === 'NUMBER') { consume(); return { type: 'NumberLiteral', value: t.value, line: t.line, col: t.col }; }
    if (t.type === 'STRING') { consume(); return { type: 'StringLiteral', value: t.value, line: t.line, col: t.col }; }
    if (t.type === 'KEYWORD' && (t.value === 'true' || t.value === 'false')) {
      consume();
      return { type: 'BoolLiteral', value: t.value === 'true', line: t.line, col: t.col };
    }
    if (t.type === 'IDENT') { consume(); return identExpr(t.value, t.line, t.col); }
    if (t.type === 'LPAREN') {
      consume();
      const inner = parseExpression();
      if (peek().type === 'RPAREN') consume();
      else err('expected )', peek());
      return inner;
    }
    err(`unexpected token '${tokDesc(t)}' in expression`, t);
    return { type: 'NumberLiteral', value: 0, line: t.line, col: t.col };
  }

  function identExpr(name, line, col) {
    if (!name.includes('.')) return { type: 'Identifier', name, line, col };
    const parts = name.split('.');
    let node = { type: 'Identifier', name: parts[0], line, col };
    for (let k = 1; k < parts.length; k++) {
      node = { type: 'Member', object: node, property: parts[k], line, col };
    }
    return node;
  }

  function tokDesc(t) {
    if (t.type === 'EOF') return '<eof>';
    if (t.type === 'NEWLINE') return '<newline>';
    return String(t.value);
  }

  function parseProgram() {
    const body = [];
    skipNewlines();
    // Guard against the documented `stray end at top level` infinite loop bug
    // by tracking position progress.
    let lastPos = -1;
    while (!eof()) {
      if (pos === lastPos) {
        // Parser didn't advance — eat one token and continue so we never spin.
        err('parser stuck — skipping token', peek());
        consume();
        skipNewlines();
        continue;
      }
      lastPos = pos;
      const stmt = parseStatement();
      if (stmt) body.push(stmt);
      skipNewlines();
    }
    return { type: 'Program', body, line: 1, col: 1 };
  }

  function parseStatement() {
    const t = peek();

    if (t.type === 'KEYWORD') {
      switch (t.value) {
        case 'on':    return parseEventHandler();
        case 'if':    return parseIf();
        case 'while': return parseWhile();
        case 'tell':  return parseTell();
        case 'done':  consume(); return { type: 'Done', line: t.line, col: t.col };
        case 'end': case 'else': case 'elseif': case 'then':
        case 'do':  case 'option': case 'in': case 'at': case 'to':
          return null;
      }
    }

    if (t.type === 'IDENT') {
      const next = peek(1);
      if (next.type === 'OP' && (next.value === '=' || next.value === '+=' ||
          next.value === '-=' || next.value === '*=' || next.value === '/=')) {
        return parseAssignment();
      }
      if (next.type === 'OP' && (next.value === '++' || next.value === '--')) {
        return parseIncDec();
      }
      const lower = t.value.toLowerCase();
      if (COMMAND_NAMES.has(lower)) return parseCommand();
      const start = consume();
      err(`unexpected identifier '${start.value}' at statement position`, start);
      recoverToLineEnd();
      return null;
    }

    if (t.type === 'NEWLINE') { consume(); return null; }
    err(`unexpected token '${tokDesc(t)}'`, t);
    recoverToLineEnd();
    return null;
  }

  function parseEventHandler() {
    const onTok = consume();
    const nameTok = peek();
    let event;
    if (nameTok.type === 'IDENT' || (nameTok.type === 'KEYWORD' &&
        !['do', 'end', 'if', 'else', 'elseif', 'then', 'while', 'tell', 'to'].includes(nameTok.value))) {
      event = String(nameTok.value).toLowerCase();
      consume();
    } else {
      err('expected event name after `on`', nameTok);
      event = '<unknown>';
    }
    expectKeyword('do');
    skipNewlines();
    const body = parseBlockUntil(['end']);
    expectKeyword('end');
    return { type: 'EventHandler', event, body, line: onTok.line, col: onTok.col };
  }

  function parseBlockUntil(stopKeywords) {
    const stop = new Set(stopKeywords);
    const body = [];
    let lastPos = -1;
    while (!eof()) {
      skipNewlines();
      if (pos === lastPos) { consume(); continue; }
      lastPos = pos;
      const t = peek();
      if (t.type === 'KEYWORD' && stop.has(t.value)) break;
      if (t.type === 'EOF') break;
      const stmt = parseStatement();
      if (stmt) body.push(stmt);
      else if (peek().type === 'KEYWORD' && stop.has(peek().value)) break;
    }
    return body;
  }

  function parseIf() {
    const ifTok = consume();
    const cond = parseExpression();
    expectKeyword('then');
    skipNewlines();
    const thenBody = parseBlockUntil(['elseif', 'else', 'end']);
    const elifs = [];
    let elseBody = null;
    while (peek().type === 'KEYWORD' && peek().value === 'elseif') {
      consume();
      const c = parseExpression();
      expectKeyword('then');
      skipNewlines();
      const b = parseBlockUntil(['elseif', 'else', 'end']);
      elifs.push({ cond: c, body: b });
    }
    if (peek().type === 'KEYWORD' && peek().value === 'else') {
      consume();
      skipNewlines();
      elseBody = parseBlockUntil(['end']);
    }
    expectKeyword('end');
    return { type: 'If', cond, then: thenBody, elifs, else: elseBody, line: ifTok.line, col: ifTok.col };
  }

  function parseWhile() {
    const wTok = consume();
    const cond = parseExpression();
    expectKeyword('do');
    skipNewlines();
    const body = parseBlockUntil(['end']);
    expectKeyword('end');
    return { type: 'While', cond, body, line: wTok.line, col: wTok.col };
  }

  function parseTell() {
    const tTok = consume();
    const targets = [parseExpression()];
    while (peek().type === 'COMMA') { consume(); targets.push(parseExpression()); }
    expectKeyword('to');
    skipNewlines();
    const body = parseBlockUntil(['end']);
    expectKeyword('end');
    const target = targets.length === 1 ? targets[0]
      : { type: 'TupleExpression', elements: targets, line: tTok.line, col: tTok.col };
    return { type: 'Tell', target, body, line: tTok.line, col: tTok.col };
  }

  function parseAssignment() {
    const idTok = consume();
    const target = identExpr(idTok.value, idTok.line, idTok.col);
    const opTok = consume();
    const value = parseExpression();
    return { type: 'Assignment', target, op: opTok.value, value, line: idTok.line, col: idTok.col };
  }

  function parseIncDec() {
    const idTok = consume();
    const target = identExpr(idTok.value, idTok.line, idTok.col);
    const opTok = consume();
    return { type: 'IncDec', target, op: opTok.value, line: idTok.line, col: idTok.col };
  }

  function parseCommand() {
    const nameTok = consume();
    const name = nameTok.value.toLowerCase();
    const args = [];

    while (!eof()) {
      const t = peek();
      if (t.type === 'NEWLINE' || t.type === 'EOF') break;
      if (t.type === 'KEYWORD' && (t.value === 'then' || t.value === 'do' ||
          t.value === 'end' || t.value === 'else' || t.value === 'elseif' ||
          t.value === 'option')) break;
      if (t.type === 'COMMA') { consume(); continue; }
      if (t.type === 'KEYWORD' && (t.value === 'at' || t.value === 'in' || t.value === 'to')) {
        consume();
        args.push({ type: 'Marker', value: t.value, line: t.line, col: t.col });
        continue;
      }
      args.push(parseExpression());
    }

    const node = {
      type: 'Call', name, args,
      block: null, options: null,
      line: nameTok.line, col: nameTok.col,
    };

    if (BLOCK_COMMANDS.has(name) && peek().type === 'KEYWORD' && peek().value === 'then') {
      consume();
      skipNewlines();
      if (OPTION_BLOCK_COMMANDS.has(name)) {
        node.options = [];
        while (true) {
          skipNewlines();
          const p = peek();
          if (p.type === 'KEYWORD' && p.value === 'option') {
            consume();
            const labelTok = peek();
            let label;
            if (labelTok.type === 'STRING') { consume(); label = labelTok.value; }
            else { err('expected string after `option`', labelTok); label = ''; }
            expectKeyword('then');
            skipNewlines();
            const optBody = parseBlockUntil(['option', 'end']);
            node.options.push({ label, body: optBody });
          } else break;
        }
      } else {
        node.block = parseBlockUntil(['end']);
      }
      expectKeyword('end');
    }

    return node;
  }

  const ast = parseProgram();
  return { ast, errors, tokens };
}
