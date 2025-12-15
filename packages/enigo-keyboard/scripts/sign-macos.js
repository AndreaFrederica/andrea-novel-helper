#!/usr/bin/env node

/**
 * macOS 代码签名脚本
 * 用于对 .node 原生模块进行签名
 * 
 * 使用方式：
 *   npm run sign:macos                    # 使用 ad-hoc 签名（开发）
 *   MACOS_SIGN_IDENTITY="Developer ID" npm run sign:macos  # 使用开发者证书
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');

const platform = process.platform;

if (platform !== 'darwin') {
  console.log('ℹ Skipping: This script only runs on macOS');
  process.exit(0);
}

console.log('📝 macOS Code Signing\n');

const filesToSign = [
  'enigo_keyboard.node',
  'dist/enigo_keyboard.node',
];

const devIdentity = process.env.MACOS_SIGN_IDENTITY || '-';
const verbose = process.env.VERBOSE === 'true';

console.log(`Configuration:`);
console.log(`  Identity: ${devIdentity === '-' ? 'ad-hoc (development)' : devIdentity}`);
console.log(`  Verbose: ${verbose ? 'yes' : 'no'}\n`);

let signedCount = 0;
let skippedCount = 0;
let failedCount = 0;

filesToSign.forEach(file => {
  const fullPath = path.join(packageRoot, file);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⊘ Skipped (not found): ${file}`);
    skippedCount++;
    return;
  }
  
  try {
    console.log(`📝 Signing: ${file}`);
    
    const cmd = `codesign --force --sign "${devIdentity}"${verbose ? ' --verbose' : ''} "${fullPath}"`;
    
    if (verbose) {
      console.log(`   Command: ${cmd}`);
    }
    
    execSync(cmd, { stdio: verbose ? 'inherit' : 'pipe' });
    
    // Verify signature
    try {
      const verifyCmd = `codesign --verify --verbose=4 "${fullPath}"`;
      if (verbose) {
        console.log(`   Verifying...`);
        execSync(verifyCmd, { stdio: 'inherit' });
      } else {
        execSync(verifyCmd, { stdio: 'pipe' });
      }
      console.log(`✓ Signed and verified: ${file}\n`);
      signedCount++;
    } catch (verifyErr) {
      console.warn(`⚠ Warning: Signed but verification failed: ${file}`);
      console.warn(`   ${verifyErr.message}\n`);
      signedCount++;
    }
  } catch (err) {
    console.error(`✗ Failed to sign ${file}:`);
    console.error(`   ${err.message}\n`);
    failedCount++;
  }
});

console.log(`Summary:`);
console.log(`  ✓ Signed: ${signedCount}`);
console.log(`  ⊘ Skipped: ${skippedCount}`);
console.log(`  ✗ Failed: ${failedCount}`);

if (failedCount > 0) {
  console.error('\n❌ Some files failed to sign');
  process.exit(1);
} else if (signedCount === 0) {
  console.warn('\n⚠ No files were signed');
  process.exit(0);
} else {
  console.log('\n✅ All files signed successfully');
  process.exit(0);
}
