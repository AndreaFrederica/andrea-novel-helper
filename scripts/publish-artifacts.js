/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const readline = require('readline');

const repoRoot = path.resolve(__dirname, '..');
const defaultEnvPath = path.join(repoRoot, '.env.publish.local');
const defaultArtifactsDir = path.join(repoRoot, 'release_artifacts');

function usage() {
  console.log(`Usage:
  npm run publish:artifacts -- [artifact-dir] [options]
  node scripts/publish-artifacts.js [artifact-dir] [options]

Options:
  --env <file>          Env file with VSCE_PAT and OVSX_PAT. Default: .env.publish.local
  --marketplace-only    Publish only to VS Code Marketplace
  --openvsx-only        Publish only to Open VSX
  --std-only            Publish only anh-std-*.vsix
  --exp-only            Publish only anh-exp-*.vsix as pre-release
  --target <target>     Publish only one target, e.g. linux-arm64. Can be repeated.
  --allow-version-mismatch
                        Do not verify VSIX versions against package.json
  --dry-run             Print commands without publishing
  --yes                 Skip confirmation prompt
  --help                Show this help

Env aliases:
  VSCE_PAT, MARKETPLACE_PAT, AZURE_DEVOPS_EXT_PAT
  OVSX_PAT, OPENVSX_PAT
`);
}

function parseArgs(argv) {
  const opts = {
    artifactsDir: process.env.PUBLISH_ARTIFACTS_DIR || defaultArtifactsDir,
    envPath: process.env.PUBLISH_ENV_FILE || defaultEnvPath,
    marketplace: true,
    openvsx: true,
    std: true,
    exp: true,
    targets: [],
    allowVersionMismatch: false,
    dryRun: false,
    yes: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else if (arg === '--env') {
      opts.envPath = path.resolve(argv[++i] || '');
    } else if (arg === '--marketplace-only') {
      opts.marketplace = true;
      opts.openvsx = false;
    } else if (arg === '--openvsx-only') {
      opts.marketplace = false;
      opts.openvsx = true;
    } else if (arg === '--std-only') {
      opts.std = true;
      opts.exp = false;
    } else if (arg === '--exp-only') {
      opts.std = false;
      opts.exp = true;
    } else if (arg === '--target') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) {
        throw new Error('--target requires a value.');
      }
      opts.targets.push(value.toLowerCase());
    } else if (arg === '--allow-version-mismatch') {
      opts.allowVersionMismatch = true;
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--yes' || arg === '-y') {
      opts.yes = true;
    } else if (arg.startsWith('--')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      opts.artifactsDir = path.resolve(arg);
    }
  }

  if (!opts.marketplace && !opts.openvsx) {
    throw new Error('No publish target selected.');
  }
  if (!opts.std && !opts.exp) {
    throw new Error('No variant selected.');
  }
  return opts;
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }

  const env = {};
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      throw new Error(`Invalid env line in ${filePath}: ${line}`);
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  }
  return env;
}

function findFiles(root, predicate) {
  const out = [];
  if (!fs.existsSync(root)) {
    return out;
  }

  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    const stat = fs.statSync(current);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry));
      }
    } else if (stat.isFile() && predicate(current)) {
      out.push(current);
    }
  }
  return out.sort((a, b) => a.localeCompare(b));
}

function commandExists(command) {
  const checker = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [command] : ['-v', command];
  const result = cp.spawnSync(checker, args, { stdio: 'ignore', shell: process.platform !== 'win32' });
  return result.status === 0;
}

function run(command, args, env, dryRun) {
  const printable = [command, ...args.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');
  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return;
  }

  const result = cp.spawnSync(command, args, {
    cwd: repoRoot,
    stdio: ['inherit', 'inherit', 'pipe'],
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const err = new Error(`Command failed with exit code ${result.status}: ${printable}`);
    err.stderr = stderr;
    throw err;
  }
}

function runCapture(command, args) {
  const result = cp.spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    throw new Error(stderr || `Command failed with exit code ${result.status}: ${command} ${args.join(' ')}`);
  }
  return result.stdout || '';
}

function unzip(zipFile, outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });
  if (process.platform === 'win32') {
    const ps = commandExists('pwsh') ? 'pwsh' : 'powershell';
    run(ps, [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath ${JSON.stringify(zipFile)} -DestinationPath ${JSON.stringify(outputDir)} -Force`,
    ], {}, false);
    return;
  }

  if (!commandExists('unzip')) {
    throw new Error(`Found zip artifact but 'unzip' is not available: ${zipFile}`);
  }
  run('unzip', ['-oq', zipFile, '-d', outputDir], {}, false);
}

function collectVsixFiles(artifactsDir) {
  if (!fs.existsSync(artifactsDir)) {
    throw new Error(`Artifact directory not found: ${artifactsDir}`);
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anh-publish-'));
  const zipFiles = findFiles(artifactsDir, (file) => file.toLowerCase().endsWith('.zip'));
  for (const zipFile of zipFiles) {
    const baseName = path.basename(zipFile, '.zip').replace(/[^A-Za-z0-9_.-]/g, '_');
    unzip(zipFile, path.join(tempDir, baseName));
  }

  const directVsix = findFiles(artifactsDir, (file) => file.toLowerCase().endsWith('.vsix'));
  const extractedVsix = findFiles(tempDir, (file) => file.toLowerCase().endsWith('.vsix'));
  const byName = new Map();
  for (const file of [...directVsix, ...extractedVsix]) {
    const name = path.basename(file).toLowerCase();
    if (!byName.has(name)) {
      byName.set(name, file);
    }
  }
  return { files: [...byName.values()].sort((a, b) => a.localeCompare(b)), tempDir };
}

function variantOf(file) {
  const name = path.basename(file).toLowerCase();
  if (name.includes('anh-exp-') || name.includes('-exp-')) {
    return 'exp';
  }
  if (name.includes('anh-std-') || name.includes('-std-')) {
    return 'std';
  }
  return 'std';
}

function targetOf(file) {
  const name = path.basename(file).toLowerCase();
  const match = name.match(/^anh-(?:std|exp)-(.+)\.vsix$/);
  return match ? match[1] : name;
}

function sortPublishableFiles(files) {
  return [...files].sort((a, b) => {
    const variantRank = { std: 0, exp: 1 };
    const va = variantRank[variantOf(a)];
    const vb = variantRank[variantOf(b)];
    if (va !== vb) {
      return va - vb;
    }

    const targetCmp = targetOf(a).localeCompare(targetOf(b), undefined, { numeric: true });
    if (targetCmp !== 0) {
      return targetCmp;
    }

    return a.localeCompare(b);
  });
}

function readRootPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error('package.json does not contain a valid version.');
  }
  return pkg.version;
}

function nextPatchVersion(version) {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    throw new Error(`Invalid semver in package.json: ${version}`);
  }
  parts[2] += 1;
  return parts.join('.');
}

function readVsixPackageVersion(file) {
  let content = '';
  if (process.platform === 'win32') {
    const ps = commandExists('pwsh') ? 'pwsh' : 'powershell';
    const script = [
      '$ErrorActionPreference = "Stop";',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem;',
      `$zip = [IO.Compression.ZipFile]::OpenRead(${JSON.stringify(file)});`,
      'try {',
      '  $entry = $zip.GetEntry("extension/package.json");',
      '  if ($null -eq $entry) { throw "extension/package.json not found"; }',
      '  $reader = [IO.StreamReader]::new($entry.Open());',
      '  try { $reader.ReadToEnd(); } finally { $reader.Dispose(); }',
      '} finally { $zip.Dispose(); }',
    ].join(' ');
    content = runCapture(ps, ['-NoProfile', '-Command', script]);
  } else {
    if (!commandExists('unzip')) {
      throw new Error(`Cannot verify VSIX version because 'unzip' is not available: ${file}`);
    }
    content = runCapture('unzip', ['-p', file, 'extension/package.json']);
  }

  const pkg = JSON.parse(content);
  if (!pkg.version || typeof pkg.version !== 'string') {
    throw new Error(`VSIX package.json does not contain a valid version: ${file}`);
  }
  return pkg.version;
}

function collectPackageVersions(files) {
  const versions = new Map();
  for (const file of files) {
    versions.set(file, readVsixPackageVersion(file));
  }
  return versions;
}

function validatePackageVersions(files, opts) {
  const versions = collectPackageVersions(files);
  if (opts.allowVersionMismatch) {
    return versions;
  }

  const stdVersion = readRootPackageVersion();
  const expVersion = nextPatchVersion(stdVersion);
  const errors = [];
  for (const file of files) {
    const variant = variantOf(file);
    const expected = variant === 'exp' ? expVersion : stdVersion;
    const actual = versions.get(file);
    if (actual !== expected) {
      errors.push(`${path.relative(repoRoot, file)} is ${actual}, expected ${expected} for ${variant}`);
    }
  }

  if (errors.length) {
    throw new Error(`Refusing to publish VSIX files with unexpected versions:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return versions;
}

function shouldSkip(file, opts) {
  const name = path.basename(file).toLowerCase();
  if (name.includes('win32-ia32')) {
    return 'unsupported win32-ia32 target';
  }
  const variant = variantOf(file);
  if (variant === 'std' && !opts.std) {
    return 'std variant disabled';
  }
  if (variant === 'exp' && !opts.exp) {
    return 'exp variant disabled';
  }
  if (opts.targets.length && !opts.targets.includes(targetOf(file))) {
    return 'target disabled';
  }
  return '';
}

function publishToMarketplace(file, opts, env) {
  const isPreRelease = variantOf(file) === 'exp';
  const preReleaseArg = isPreRelease ? ['--pre-release'] : [];
  run('npx', [
    '--yes',
    '--package',
    '@vscode/vsce',
    'vsce',
    'publish',
    '--packagePath',
    file,
    ...preReleaseArg,
  ], env, opts.dryRun);
}

function publishToOpenVsx(file, opts, env) {
  const isPreRelease = variantOf(file) === 'exp';
  const preReleaseArg = isPreRelease ? ['--pre-release'] : [];
  run('npx', [
    '--yes',
    '--package',
    'ovsx',
    'ovsx',
    'publish',
    file,
    ...preReleaseArg,
  ], env, opts.dryRun);
}

function askConfirmation(files) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Type "publish" to publish ${files.length} VSIX file(s): `, (answer) => {
      rl.close();
      resolve(answer.trim() === 'publish');
    });
  });
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const fileEnv = parseEnvFile(opts.envPath);
  const env = {
    ...fileEnv,
    VSCE_PAT: fileEnv.VSCE_PAT || fileEnv.MARKETPLACE_PAT || fileEnv.AZURE_DEVOPS_EXT_PAT,
    OVSX_PAT: fileEnv.OVSX_PAT || fileEnv.OPENVSX_PAT,
  };

  if (opts.marketplace && !env.VSCE_PAT && !opts.dryRun) {
    throw new Error('Missing VSCE_PAT in env file.');
  }
  if (opts.openvsx && !env.OVSX_PAT && !opts.dryRun) {
    throw new Error('Missing OVSX_PAT in env file.');
  }

  const { files, tempDir } = collectVsixFiles(opts.artifactsDir);
  const publishable = sortPublishableFiles(files.filter((file) => !shouldSkip(file, opts)));
  const skipped = files
    .map((file) => ({ file, reason: shouldSkip(file, opts) }))
    .filter((entry) => entry.reason);

  if (publishable.length === 0) {
    throw new Error(`No publishable VSIX files found in ${opts.artifactsDir}`);
  }

  const packageVersions = validatePackageVersions(publishable, opts);

  console.log(`Artifact directory: ${opts.artifactsDir}`);
  console.log(`Env file: ${opts.envPath}`);
  console.log(`Targets: ${[opts.marketplace ? 'VS Code Marketplace' : '', opts.openvsx ? 'Open VSX' : ''].filter(Boolean).join(', ')}`);
  console.log('Files to publish:');
  for (const file of publishable) {
    console.log(`  - ${path.relative(repoRoot, file)} (${variantOf(file) === 'exp' ? 'pre-release' : 'release'}, v${packageVersions.get(file)})`);
  }
  for (const { file, reason } of skipped) {
    console.log(`Skipping ${path.relative(repoRoot, file)}: ${reason}`);
  }

  if (!opts.dryRun && !opts.yes) {
    const confirmed = await askConfirmation(publishable);
    if (!confirmed) {
      console.log('Publish cancelled.');
      return;
    }
  }

  const results = []; // { file, target, status: 'ok'|'exists'|'failed', error? }

  function classifyError(err) {
    const text = `${err.message || ''} ${err.stderr || ''}`.toLowerCase();
    if (text.includes('already exists') || text.includes('is already published')) {
      return 'exists';
    }
    return 'failed';
  }
  const totalOps = publishable.length * ((opts.marketplace ? 1 : 0) + (opts.openvsx ? 1 : 0));
  let opIndex = 0;

  try {
    for (const file of publishable) {
      const label = file.startsWith(repoRoot) ? path.relative(repoRoot, file) : path.basename(file);
      const variant = variantOf(file) === 'exp' ? 'pre-release' : 'release';
      const ver = packageVersions.get(file);

      if (opts.marketplace) {
        opIndex += 1;
        const tag = `[${opIndex}/${totalOps}]`;
        try {
          console.log(`\n${tag} Publishing ${label} (v${ver}, ${variant}) -> VS Code Marketplace ...`);
          publishToMarketplace(file, opts, env);
          console.log(`${tag} ${label} -> Marketplace: OK`);
          results.push({ file: label, target: 'VS Code Marketplace', status: 'ok' });
        } catch (err) {
          const status = classifyError(err);
          const icon = status === 'exists' ? 'SKIP' : 'FAILED';
          console.error(`${tag} ${label} -> Marketplace: ${icon} - ${err.message}`);
          results.push({ file: label, target: 'VS Code Marketplace', status, error: err.message });
        }
      }

      if (opts.openvsx) {
        opIndex += 1;
        const tag = `[${opIndex}/${totalOps}]`;
        try {
          console.log(`\n${tag} Publishing ${label} (v${ver}, ${variant}) -> Open VSX ...`);
          publishToOpenVsx(file, opts, env);
          console.log(`${tag} ${label} -> OpenVSX: OK`);
          results.push({ file: label, target: 'Open VSX', status: 'ok' });
        } catch (err) {
          const status = classifyError(err);
          const icon = status === 'exists' ? 'SKIP' : 'FAILED';
          console.error(`${tag} ${label} -> OpenVSX: ${icon} - ${err.message}`);
          results.push({ file: label, target: 'Open VSX', status, error: err.message });
        }
      }
    }

    // --- Summary (grouped by target) ---
    const totalSucceeded = results.filter((r) => r.status === 'ok').length;
    const totalExists = results.filter((r) => r.status === 'exists').length;
    const totalFailed = results.filter((r) => r.status === 'failed').length;

    const targets = [];
    if (opts.marketplace) targets.push('VS Code Marketplace');
    if (opts.openvsx) targets.push('Open VSX');

    console.log('\n========================================');
    console.log('  Publish Summary');
    console.log('========================================');

    for (const target of targets) {
      const targetResults = results.filter((r) => r.target === target);
      const ok = targetResults.filter((r) => r.status === 'ok');
      const exists = targetResults.filter((r) => r.status === 'exists');
      const fail = targetResults.filter((r) => r.status === 'failed');

      const parts = [];
      parts.push(`${ok.length} succeeded`);
      if (exists.length) parts.push(`${exists.length} already exists`);
      if (fail.length) parts.push(`${fail.length} FAILED`);

      console.log(`\n  ${target} (${parts.join(', ')}):`);

      for (const r of ok) {
        console.log(`    [ok]  ${r.file}`);
      }
      for (const r of exists) {
        console.log(`    [--)  ${r.file} (already published)`);
      }
      for (const r of fail) {
        console.error(`    [!!]  ${r.file}: ${r.error}`);
      }
    }

    const parts = [`${totalSucceeded} succeeded`];
    if (totalExists) parts.push(`${totalExists} already exists`);
    if (totalFailed) parts.push(`${totalFailed} FAILED`);
    console.log(`\n  Total: ${results.length} operations, ${parts.join(', ')}`);
    console.log('========================================');

    if (totalFailed) {
      process.exitCode = 1;
    } else {
      console.log('\nPublish completed.');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
