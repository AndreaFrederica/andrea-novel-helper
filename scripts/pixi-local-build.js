/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const cp = require('child_process');

const pkgPath = 'package.json';
const original = fs.readFileSync(pkgPath, 'utf8');

function run(cmd, args, env) {
  const result = cp.spawnSync(cmd, args, {
    stdio: 'inherit',
    env: { ...process.env, ...(env || {}) },
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const suffix = result.signal ? ` signal ${result.signal}` : ` exit ${result.status}`;
    throw new Error(`${cmd} ${args.join(' ')} failed with${suffix}`);
  }
}

function restore() {
  fs.writeFileSync(pkgPath, original);
}

function readPackage() {
  return JSON.parse(original);
}

function modify(variant, buildBothVariants) {
  const pkg = readPackage();
  const ev = new Set(pkg.activationEvents || []);

  if (variant === 'std') {
    ev.delete('onStartupFinished');
  } else {
    ev.add('onStartupFinished');
    if (buildBothVariants) {
      const parts = pkg.version.split('.').map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) {
        throw new Error(`Invalid semver: ${pkg.version}`);
      }
      parts[2] += 1;
      pkg.version = parts.join('.');
    }
  }

  pkg.activationEvents = [...ev];
  if (pkg.scripts && pkg.scripts['vscode:prepublish']) {
    pkg.scripts['vscode:prepublish'] = 'npm run compile';
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
}

function mapTarget() {
  const platform = process.platform === 'win32'
    ? 'win32'
    : process.platform === 'darwin'
      ? 'darwin'
      : 'linux';
  let arch = 'x64';
  if (process.arch === 'ia32') arch = 'ia32';
  else if (process.arch === 'arm64') arch = 'arm64';
  else if (process.arch === 'arm') arch = 'armhf';
  return `${platform}-${arch}`;
}

function parseTarget(targetArg) {
  const [platform, arch] = targetArg.split('-');
  if (!platform || !arch) {
    throw new Error(`Invalid target: ${targetArg}`);
  }
  return { platform, arch };
}

function packageVariant(variant, targetArg, buildBothVariants) {
  const out = `dist/anh-${variant}-${targetArg}.vsix`;
  const args = ['vsce', 'package', '--target', targetArg];
  if (variant === 'exp' && buildBothVariants) args.push('--pre-release');
  args.push('--out', out);

  modify(variant, buildBothVariants);
  try {
    run('npx', args);
  } finally {
    restore();
  }
}

function main() {
  const variantArg = process.argv[2] || 'std';
  const targetArg = process.argv[3] || mapTarget();
  const variants = variantArg === 'both' ? ['std', 'exp'] : [variantArg];
  const buildBothVariants = variants.length === 2;
  const ev = process.env.ELECTRON_VERSION || '30.0.9';
  const { platform, arch } = parseTarget(targetArg);

  for (const variant of variants) {
    if (variant !== 'std' && variant !== 'exp') {
      throw new Error(`Invalid variant: ${variant}. Expected std, exp, or both.`);
    }
  }

  if (process.env.SKIP_WEBVIEW !== '1') {
    run('npm', ['--workspace=packages/webview', 'run', 'build']);
  }

  run('npm', ['run', 'compile']);
  run('npm', [
    'rebuild',
    '@vscode/sqlite3',
    '--runtime=electron',
    `--target=${ev}`,
    '--dist-url=https://electronjs.org/headers',
    `--platform=${platform}`,
    `--arch=${arch}`,
  ]);

  fs.mkdirSync('dist', { recursive: true });
  for (const variant of variants) {
    packageVariant(variant, targetArg, buildBothVariants);
  }
}

try {
  main();
} catch (error) {
  restore();
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
}
