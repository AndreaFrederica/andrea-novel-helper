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
    stdio: 'inherit',
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`Command failed with exit code ${result.status}: ${printable}`);
  }
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
  return '';
}

function publishFile(file, opts, env) {
  const isPreRelease = variantOf(file) === 'exp';
  const preReleaseArg = isPreRelease ? ['--pre-release'] : [];

  if (opts.marketplace) {
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

  if (opts.openvsx) {
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
  const publishable = files.filter((file) => !shouldSkip(file, opts));
  const skipped = files
    .map((file) => ({ file, reason: shouldSkip(file, opts) }))
    .filter((entry) => entry.reason);

  if (publishable.length === 0) {
    throw new Error(`No publishable VSIX files found in ${opts.artifactsDir}`);
  }

  console.log(`Artifact directory: ${opts.artifactsDir}`);
  console.log(`Env file: ${opts.envPath}`);
  console.log(`Targets: ${[opts.marketplace ? 'VS Code Marketplace' : '', opts.openvsx ? 'Open VSX' : ''].filter(Boolean).join(', ')}`);
  console.log('Files to publish:');
  for (const file of publishable) {
    console.log(`  - ${path.relative(repoRoot, file)} (${variantOf(file) === 'exp' ? 'pre-release' : 'release'})`);
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

  try {
    for (const file of publishable) {
      publishFile(file, opts, env);
    }
    console.log('Publish completed.');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
