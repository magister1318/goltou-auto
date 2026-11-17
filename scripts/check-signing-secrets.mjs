import { execFileSync } from 'node:child_process';

// Read the Git index, including staged changes, without ever printing values.
export function signingSecretViolations(entries) {
  const problems = [];
  for (const { name, content } of entries) {
    if (/(?:^|\/)release-key(?:\/|$)|\.(?:jks|keystore|p12|pfx)$/i.test(name) ||
        /(?:^|\/)(?:keystore|release-signing)\.properties$/i.test(name)) {
      problems.push(name); continue;
    }
    if (/\.(?:properties|env|ini|ya?ml|json)$|(?:^|\/)\.env(?:\.|$)/i.test(name) &&
        /^\s*["']?(?:storePassword|keyPassword|password|passwd|secret|token|api[_-]?key)["']?\s*[:=]\s*\S/im.test(content)) problems.push(name);
  }
  return problems;
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/check-signing-secrets.mjs')) {
  const names = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
  const entries = names.map(name => ({ name, content: /\.(?:properties|env|ini|ya?ml|json)$|(?:^|\/)\.env(?:\.|$)/i.test(name)
    ? execFileSync('git', ['show', `:${name}`], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }) : '' }));
  const problems = signingSecretViolations(entries);
  if (problems.length) {
    // No file contents, property values or credentials in diagnostics.
    console.error('TRACKED_SIGNING_SECRET_FILE_OR_PROPERTY'); process.exitCode = 1;
  } else console.log('SIGNING_SECRETS_CHECK_PASSED');
}
