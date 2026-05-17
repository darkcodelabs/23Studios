'use strict';

// PulpScript -> Lua transpiler. Public entry.
//
//   transpile(source, opts) -> { lua, ast, warnings, errors }
//   parseOnly(source)        -> { ast, errors }
//   tokenize(source)         -> { tokens, errors }
//
// `opts` keys:
//   scope:     'tile' | 'room' | 'game'  (default 'game')
//   namespace: string                    (default 'game')
//
// The generated Lua targets the runtime in server/services/pulp_runtime_lua/.

const { tokenize } = require('./pulp_transpiler/tokenizer');
const { parse }    = require('./pulp_transpiler/parser');
const { generate } = require('./pulp_transpiler/codegen');

function transpile(source, opts) {
  const options = opts || {};
  const { ast, errors } = parse(source);
  const { lua, warnings } = generate(ast, options);
  return { lua, ast, warnings, errors };
}

function parseOnly(source) {
  const { ast, errors } = parse(source);
  return { ast, errors };
}

function tokenizeSrc(source) {
  return tokenize(source);
}

module.exports = {
  transpile,
  parseOnly,
  tokenize: tokenizeSrc,
};
