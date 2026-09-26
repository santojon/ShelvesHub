import reactHooks from 'eslint-plugin-react-hooks';

const MAX_LINE_COMMENT_LINES = 3;
const MAX_BLOCK_COMMENT_LINES = 5;

// Caps consecutive `//` comments and `/* */` blocks — long-form notes go in docs.
const commentLengthPlugin = {
  rules: {
    'comment-length': {
      meta: {
        type: 'suggestion',
        docs: { description: 'Limit consecutive // comments and /* */ block comments.' },
        messages: {
          tooManyLines: 'Consecutive `//` comments capped at {{max}} lines (saw {{actual}}).',
          tooLongBlock: '`/* */` block comment capped at {{max}} lines (saw {{actual}}).',
        },
        schema: [],
      },
      create(context) {
        const sc = context.sourceCode;
        function reportGroup(group) {
          if (group.length <= MAX_LINE_COMMENT_LINES) return;
          context.report({
            node: group[0],
            loc: { start: group[0].loc.start, end: group[group.length - 1].loc.end },
            messageId: 'tooManyLines',
            data: { max: MAX_LINE_COMMENT_LINES, actual: group.length },
          });
        }
        return {
          Program() {
            const comments = sc.getAllComments();
            let group = [];
            for (const c of comments) {
              if (c.type === 'Line') {
                if (group.length && group[group.length - 1].loc.end.line + 1 === c.loc.start.line) {
                  group.push(c);
                } else {
                  reportGroup(group);
                  group = [c];
                }
              } else if (c.type === 'Block') {
                reportGroup(group);
                group = [];
                const lines = (c.value.match(/\n/g) || []).length + 1;
                if (lines > MAX_BLOCK_COMMENT_LINES) {
                  context.report({ node: c, messageId: 'tooLongBlock', data: { max: MAX_BLOCK_COMMENT_LINES, actual: lines } });
                }
              }
            }
            reportGroup(group);
          },
        };
      },
    },
  },
};

// Bug-catching + modern-JS rules (minus the TS-type-aware ones — this is plain
// JS). Legacy `runtime/shelves-host.js` violations are baselined via eslint bulk
// suppressions; new violations fail. Retrofit opportunistically.
const rules = {
  complexity: ['error', 10],
  'max-lines': ['error', { max: 1000, skipBlankLines: true, skipComments: true }],
  'react-hooks/rules-of-hooks': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  eqeqeq: ['error', 'smart'],
  'no-debugger': 'error',
  'no-throw-literal': 'error',
  'no-duplicate-imports': 'error',
  'no-self-assign': 'error',
  'no-unreachable': 'error',
  'no-fallthrough': 'error',
  'no-unsafe-optional-chaining': 'error',
  'no-constant-binary-expression': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'no-async-promise-executor': 'error',
  'no-dupe-else-if': 'error',
  'no-cond-assign': ['error', 'always'],
  'ds-local/comment-length': 'error',
};

const plugins = { 'react-hooks': reactHooks, 'ds-local': commentLengthPlugin };
const linterOptions = { reportUnusedDisableDirectives: 'off' };

export default [
  {
    ignores: ['node_modules/**', 'target/**', 'bundle/**', 'deckprobe/**', 'examples/harness/vendor/**', 'site/**', 'host/**', 'deckprobe-ext/**'],
  },
  {
    // ES module scripts (build/devtools tooling).
    files: ['scripts/**/*.mjs', '*.mjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    plugins,
    linterOptions,
    rules,
  },
  {
    // The injected runtime: a browser-context script, not a module. shelves-host.js
    // and its shelves-host.part*.js siblings are function-body fragments the loader
    // concatenates into one IIFE, so top-level `return` is legal (allowReturnOutsideFunction).
    files: ['runtime/**/*.js', 'examples/harness/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'script', parserOptions: { ecmaFeatures: { globalReturn: true } }, globals: { window: 'readonly', document: 'readonly', globalThis: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly', localStorage: 'readonly', requestAnimationFrame: 'readonly' } },
    plugins,
    linterOptions,
    rules,
  },
];
