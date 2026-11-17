import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { Script } from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Desktop Node's ICU accepts property escapes that nodejs-mobile cannot parse.
// Check decoded strings too: constructors and serialized browser scripts can
// otherwise hide an unsupported pattern from a regex-literal-only scan.
export function incompatiblePatterns(text, file = 'engine.cjs') {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const failures = [];
  function visit(node) {
    if ((ts.isRegularExpressionLiteral(node) || ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /\\[pP]\{/.test(node.text)) {
      failures.push(source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

export function checkFiles(files, bundle = false) {
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (bundle) new Script(text, { filename: path.basename(file) });
    const lines = incompatiblePatterns(text, file);
    if (lines.length) throw new Error(`EMBEDDED_UNICODE_PROPERTY_ESCAPE:${path.basename(file)}:${lines.join(',')}`);
  }
}

function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(item => {
    const file = path.join(directory, item.name);
    return item.isDirectory() ? sources(file) : /\.[cm]?[jt]sx?$/.test(file) ? [file] : [];
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceMode = process.argv[2] === '--sources';
  const files = sourceMode ? ['core', 'sites', 'surface', 'api-client'].flatMap(name => sources(`packages/${name}/src`)).concat(sources('apps/android/bridge')) : process.argv.slice(2);
  if (!files.length) throw new Error('EMBEDDED_COMPAT_FILES_REQUIRED');
  checkFiles(files, !sourceMode);
  console.log(`EMBEDDED_COMPAT_PASSED files=${files.length}`);
}
