'use strict';

// PulpScript parser. Consumes the token stream from tokenizer.js.
//
// AST is a plain JSON tree so Agent E's JS interpreter can reuse it. Every
// node has { type, line, col, ... }. The top-level Program node has a
// `body` array of statements.
//
// Node types:
//   Program            { body: Statement[] }
//   EventHandler       { event: string, body: Statement[] }
//   Assignment         { target: Identifier|Member, op: '='|'+='|'-='|'*='|'/=' , value: Expression }
//   IncDec             { target: Identifier|Member, op: '++'|'--' }
//   If                 { cond: Expression, then: Statement[],
//                        elifs: Array<{cond, body}>, else: Statement[]|null }
//   While              { cond: Expression, body: Statement[] }
//   Tell               { target: Expression, body: Statement[] }
//   Done               {}
//   Call               { name: string, args: Expression[],
//                        block?: Statement[], options?: Array<{label, body}> }
//        (`name` is the bare command keyword: say/ask/menu/fin/swap/frame/play/
//         sound/once/loop/stop/bpm/goto/draw/hide/window/label/fill/crop/
//         listen/ignore/act/store/restore/toss/log/dump/wait/shake/call/emit/
//         mimic/random/floor/ceil/round/sine/cosine/tangent/radians/degrees/
//         invert/solid/type/id/name.)
//   Identifier         { name: string }
//   Member             { object: Expression, property: string }
//   NumberLiteral      { value: number }
//   StringLiteral      { value: string }
//   BoolLiteral        { value: boolean }
//   Binary             { op: string, left, right }
//   Unary              { op: '-', operand }

const { tokenize } = require('./tokenizer');

// Commands that consume their trailing tokens as a list of positional args
// (comma- or whitespace- separated) until end-of-line / block keyword.
const COMMAND_NAMES = new Set([
  // text
  'say', 'ask', 'menu', 'fin',
  // game state
  'goto', 'swap', 'play', 'wait', 'shake',
  // tile interaction
  'call', 'emit', 'mimic', 'act',
  // drawing
  'draw', 'hide', 'window', 'label', 'fill', 'crop',
  // input
  'listen', 'ignore',
  // audio
  'sound', 'once', 'loop', 'stop', 'bpm',
  // persistence
  'store', 'restore', 'toss',
  // queries / misc
  'frame', 'log', 'dump',
  'solid', 'type', 'id', 'name', 'invert',
  // math (rarely standalone but legal)
  'random', 'floor', 'ceil', 'round',
  'sine', 'cosine', 'tangent', 'radians', 'degrees',
]);

// Commands that may be followed by a `then ... end` block (with optional
// `option "..." then ... end` clauses inside, for ask/menu).
const BLOCK_COMMANDS = new Set([
  'say', 'ask', 'menu', 'play', 'once', 'wait', 'shake',
]);

// Commands that accept `option "..." then ... end` children inside their block.
const OPTION_BLOCK_COMMANDS = new Set(['ask', 'menu']);

function parse(source) {
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

  // Recover by advancing to the next NEWLINE / EOF after a parse error.
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

  // ---- Expressions ----
  //
  // Precedence (low -> high):
  //   or-equiv: not present in spec; we keep flat.
  //   comparison: == != < <= > >=
  //   additive:  + -
  //   multiplicative: * / %
  //   unary: -
  //   primary: literal, identifier, member, paren.

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
    if (t.type === 'NUMBER') {
      consume();
      return { type: 'NumberLiteral', value: t.value, line: t.line, col: t.col };
    }
    if (t.type === 'STRING') {
      consume();
      return { type: 'StringLiteral', value: t.value, line: t.line, col: t.col };
    }
    if (t.type === 'KEYWORD' && (t.value === 'true' || t.value === 'false')) {
      consume();
      return { type: 'BoolLiteral', value: t.value === 'true', line: t.line, col: t.col };
    }
    if (t.type === 'IDENT') {
      consume();
      // Allow dotted access already merged into the identifier text by the
      // tokenizer (e.g. `event.dx`). Split into Member chain so codegen can
      // route through pulp.event / pulp.config / pulp.datetime.
      return identExpr(t.value, t.line, t.col);
    }
    if (t.type === 'LPAREN') {
      consume();
      const inner = parseExpression();
      if (peek().type === 'RPAREN') consume();
      else err('expected )', peek());
      return inner;
    }
    err(`unexpected token '${tokDesc(t)}' in expression`, t);
    // Synthesize a 0 so callers can keep going.
    return { type: 'NumberLiteral', value: 0, line: t.line, col: t.col };
  }

  function identExpr(name, line, col) {
    if (!name.includes('.')) {
      return { type: 'Identifier', name, line, col };
    }
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

  // ---- Statements ----

  function parseProgram() {
    const body = [];
    skipNewlines();
    while (!eof()) {
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
        // `end`/`else`/`elseif`/`then`/`do`/`option` at this level means the
        // caller should stop — just return null and let it bubble.
        case 'end': case 'else': case 'elseif': case 'then':
        case 'do':  case 'option': case 'in': case 'at': case 'to':
          return null;
      }
    }

    if (t.type === 'IDENT') {
      // Could be assignment, increment, or command (commands are identifiers
      // whose name is in COMMAND_NAMES).
      const next = peek(1);
      // Assignment forms: ident = expr, ident += expr, etc.
      if (next.type === 'OP' && (next.value === '=' || next.value === '+=' ||
          next.value === '-=' || next.value === '*=' || next.value === '/=')) {
        return parseAssignment();
      }
      if (next.type === 'OP' && (next.value === '++' || next.value === '--')) {
        return parseIncDec();
      }
      // Bare identifier in COMMAND_NAMES => command call.
      const lower = t.value.toLowerCase();
      if (COMMAND_NAMES.has(lower)) {
        return parseCommand();
      }
      // Otherwise treat as a no-op expression statement (rare in pulp).
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
    const onTok = consume(); // 'on'
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
    while (!eof()) {
      skipNewlines();
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
    const ifTok = consume(); // 'if'
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
    const wTok = consume(); // 'while'
    const cond = parseExpression();
    expectKeyword('do');
    skipNewlines();
    const body = parseBlockUntil(['end']);
    expectKeyword('end');
    return { type: 'While', cond, body, line: wTok.line, col: wTok.col };
  }

  function parseTell() {
    const tTok = consume(); // 'tell'
    // `tell <target> to ... end` where <target> can be `x,y`, an ident,
    // or a string. We parse an expression list (1 or 2 exprs).
    const targets = [];
    targets.push(parseExpression());
    while (peek().type === 'COMMA') {
      consume();
      targets.push(parseExpression());
    }
    expectKeyword('to');
    skipNewlines();
    const body = parseBlockUntil(['end']);
    expectKeyword('end');
    const target = targets.length === 1 ? targets[0]
      : { type: 'TupleExpression', elements: targets, line: tTok.line, col: tTok.col };
    return { type: 'Tell', target, body, line: tTok.line, col: tTok.col };
  }

  function parseAssignment() {
    const idTok = consume(); // ident
    const target = identExpr(idTok.value, idTok.line, idTok.col);
    const opTok = consume(); // = / += / ...
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
    const nameTok = consume(); // ident
    const name = nameTok.value.toLowerCase();
    const args = [];

    // Args are read until newline / `then` / `do` / `end` / etc., respecting
    // commas as separators but also tolerating space-separated `at x,y` forms.
    while (!eof()) {
      const t = peek();
      if (t.type === 'NEWLINE' || t.type === 'EOF') break;
      if (t.type === 'KEYWORD' && (t.value === 'then' || t.value === 'do' ||
          t.value === 'end' || t.value === 'else' || t.value === 'elseif' ||
          t.value === 'option')) break;
      if (t.type === 'COMMA') { consume(); continue; }
      // `at` and `in` and `to` are positional markers — record them as
      // string-tagged args so codegen knows the structure.
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

    // Optional trailing `then ... end` block.
    if (BLOCK_COMMANDS.has(name) && peek().type === 'KEYWORD' && peek().value === 'then') {
      consume(); // then
      skipNewlines();
      if (OPTION_BLOCK_COMMANDS.has(name)) {
        node.options = [];
        while (true) {
          skipNewlines();
          const p = peek();
          if (p.type === 'KEYWORD' && p.value === 'option') {
            consume();
            // option "label" then ... end
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

module.exports = { parse };
