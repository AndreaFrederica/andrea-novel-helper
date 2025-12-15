#!/usr/bin/env node

/**
 * 清理 Rust 编译产物和临时文件
 * 确保打包时不包含不必要的文件
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.join(__dirname, '..');

console.log('🧹 Cleaning up Rust build artifacts and temporary files...\n');

const toClean = [
  // Rust 编译产物
  { path: 'target', type: 'directory', desc: 'Rust build output' },
  { path: 'target-win32-x64', type: 'directory', desc: 'Windows cross-compile artifacts' },
  { path: 'target-darwin-x64', type: 'directory', desc: 'macOS cross-compile artifacts' },
  { path: 'target-darwin-arm64', type: 'directory', desc: 'macOS ARM cross-compile artifacts' },
  { path: 'target-linux-x64', type: 'directory', desc: 'Linux cross-compile artifacts' },
  { path: 'target-linux-arm64', type: 'directory', desc: 'Linux ARM64 cross-compile artifacts' },
  { path: 'target-linux-armhf', type: 'directory', desc: 'Linux ARM32 cross-compile artifacts' },
  
  // Cargo 锁文件
  { path: 'Cargo.lock', type: 'file', desc: 'Cargo lock file' },
  
  // Node modules in src (shouldn't be there)
  { path: 'src/node_modules', type: 'directory', desc: 'Source node_modules' },
];

let cleanedCount = 0;
let skippedCount = 0;

toClean.forEach(({ path: relativePath, type, desc }) => {
  const fullPath = path.join(packageRoot, relativePath);
  
  if (!fs.existsSync(fullPath)) {
    console.log(`⊘ Skipped (not found): ${desc}`);
    skippedCount++;
    return;
  }
  
  try {
    if (type === 'directory') {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(fullPath);
    }
    console.log(`✓ Removed: ${desc} (${relativePath})`);
    cleanedCount++;
  } catch (err) {
    console.error(`✗ Failed to remove ${desc}:`, err.message);
  }
});

console.log(`\n✅ Cleanup complete: ${cleanedCount} items removed, ${skippedCount} skipped`);

// List what remains in dist
if (fs.existsSync(path.join(packageRoot, 'dist'))) {
  const distFiles = fs.readdirSync(path.join(packageRoot, 'dist'));
  console.log(`\n📦 Packagable files in dist/:`);
  distFiles.forEach(file => {
    const filePath = path.join(packageRoot, 'dist', file);
    const stat = fs.statSync(filePath);
    const size = stat.isDirectory() ? '[DIR]' : `${(stat.size / 1024).toFixed(2)} KB`;
    console.log(`  - ${file} ${size}`);
  });
}

// Check for .node files in root
const rootNodeFiles = fs.readdirSync(packageRoot).filter(f => f.endsWith('.node'));
if (rootNodeFiles.length > 0) {
  console.log(`\n📦 .node files in root:`);
  rootNodeFiles.forEach(file => {
    const filePath = path.join(packageRoot, file);
    const stat = fs.statSync(filePath);
    console.log(`  - ${file} (${(stat.size / 1024).toFixed(2)} KB)`);
  });
}
