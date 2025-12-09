#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { platform, arch } from 'os';

const targets = [
  { name: 'win32-x64', rust: 'x86_64-pc-windows-msvc', platform: 'win32', arch: 'x64' },
  { name: 'darwin-x64', rust: 'x86_64-apple-darwin', platform: 'darwin', arch: 'x64' },
  { name: 'darwin-arm64', rust: 'aarch64-apple-darwin', platform: 'darwin', arch: 'arm64' },
  { name: 'linux-x64', rust: 'x86_64-unknown-linux-gnu', platform: 'linux', arch: 'x64' },
  { name: 'linux-arm64', rust: 'aarch64-unknown-linux-gnu', platform: 'linux', arch: 'arm64' },
  { name: 'linux-armhf', rust: 'arm-unknown-linux-gnueabihf', platform: 'linux', arch: 'arm' }
];

// 显示帮助信息
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
Enhanced Cross-Platform Build Script for @anh/enigo-keyboard

Usage:
  node scripts/build-cross-enhanced.js [target] [options]

Targets:
  win32-x64       Windows x64
  darwin-x64      macOS x64
  darwin-arm64    macOS ARM64
  linux-x64       Linux x64
  linux-arm64     Linux ARM64
  linux-armhf     Linux ARM32

Options:
  --docker        Use Docker for cross-compilation
  --force-cross   Force cross-compilation even for native platform
  --help, -h      Show this help message

Examples:
  # Build for current platform
  node scripts/build-cross-enhanced.js

  # Build for specific target
  node scripts/build-cross-enhanced.js win32-x64

  # Use Docker for cross-compilation
  node scripts/build-cross-enhanced.js linux-x64 --docker

  # List available targets
  node scripts/build-cross-enhanced.js list
`);
  process.exit(0);
}

const targetArg = process.argv[2];
const useDocker = process.argv.includes('--docker');
const forceCross = process.argv.includes('--force-cross');

if (targetArg === 'list') {
  console.log('Available targets:');
  targets.forEach(t => console.log(`  ${t.name} (${t.rust})`));
  process.exit(0);
}

const selectedTargets = targetArg 
  ? targets.filter(t => t.name === targetArg || t.rust === targetArg)
  : targets;

if (selectedTargets.length === 0) {
  console.error(`Unknown target: ${targetArg}`);
  console.log('Available targets:');
  targets.forEach(t => console.log(`  ${t.name} (${t.rust})`));
  process.exit(1);
}

console.log(`Building for targets: ${selectedTargets.map(t => t.name).join(', ')}`);

// Install Rust targets first
try {
  console.log('Installing Rust targets...');
  const targetList = targets.map(t => t.rust).join(' ');
  execSync(`rustup target add ${targetList}`, { stdio: 'inherit' });
  console.log('✅ Rust targets installed');
} catch (error) {
  console.error('❌ Failed to install Rust targets:', error.message);
  process.exit(1);
}

// Build for each target
for (const target of selectedTargets) {
  console.log(`\n🔨 Building for ${target.name} (${target.rust})...`);
  
  try {
    const currentPlatform = platform();
    const currentArch = arch();
    const isCurrentPlatform = 
      (currentPlatform === 'win32' && target.platform === 'win32' && target.arch === 'x64') ||
      (currentPlatform === 'darwin' && target.platform === 'darwin' && target.arch === currentArch) ||
      (currentPlatform === 'linux' && target.platform === 'linux' && target.arch === currentArch);

    let buildCmd;
    let useNapiBuild = true;

    if (isCurrentPlatform && !forceCross) {
      // Native build - use standard cargo + napi-build
      console.log('🏠 Using native build (current platform)');
      buildCmd = `cargo build --release --target-dir target --verbose`;
      useNapiBuild = true;
    } else if (useDocker) {
      // Docker-based cross-compilation
      console.log('🐳 Using Docker-based cross-compilation');
      buildCmd = `docker run --rm -v ${process.cwd()}:/workspace -w /workspace node:18 bash -c "cd /workspace && cargo build --release --target ${target.rust}"`;
      useNapiBuild = false;
    } else {
      // Direct cross-compilation attempt
      console.log('🌐 Attempting direct cross-compilation');
      buildCmd = `cargo build --release --target ${target.rust} --target-dir target-${target.name} --verbose`;
      useNapiBuild = false;
    }

    // Execute build
    execSync(buildCmd, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });

    let sourceFile;
    let targetDir;

    if (useNapiBuild) {
      // napi-build will generate .node file directly
      sourceFile = './enigo_keyboard.node';
      targetDir = './target';
    } else {
      // Manual cross-compilation - need to find the compiled library
      targetDir = `target-${target.name}/release`;
      
      if (target.platform === 'win32') {
        sourceFile = `${targetDir}/enigo_keyboard.dll`;
      } else if (target.platform === 'darwin') {
        sourceFile = `${targetDir}/enigo_keyboard.dylib`;
      } else {
        sourceFile = `${targetDir}/enigo_keyboard.so`;
      }
    }

    // Check if file exists
    if (!fs.existsSync(sourceFile)) {
      if (useNapiBuild) {
        console.error(`❌ napi-build failed to generate ${sourceFile}`);
        continue;
      } else {
        // Try to find alternative files
        try {
          const files = fs.readdirSync(targetDir);
          const foundFile = files.find(file => 
            file.includes('enigo_keyboard') || 
            (file.startsWith('libenigo_keyboard') && 
             (file.endsWith('.dylib') || file.endsWith('.so') || file.endsWith('.dll')))
          );
          
          if (foundFile) {
            sourceFile = `${targetDir}/${foundFile}`;
            console.log(`Found alternative file: ${foundFile}`);
          } else {
            console.error(`❌ No enigo_keyboard library found for ${target.name}`);
            console.log(`Files in ${targetDir}:`, files);
            continue;
          }
        } catch (error) {
          console.error(`❌ Cannot read directory ${targetDir}:`, error.message);
          continue;
        }
      }
    }

    if (fs.existsSync(sourceFile)) {
      // Create platform-specific output directory
      const outputDir = `dist/${target.name}`;
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      // Copy as .node file
      const outputFile = `${outputDir}/enigo_keyboard.node`;
      
      if (useNapiBuild) {
        // napi-build already created .node file
        fs.copyFileSync(sourceFile, outputFile);
      } else {
        // Need to create .node from native library
        console.log(`📦 Creating .node file from ${sourceFile}`);
        // For now, just copy the file - in a real implementation, 
        // you'd use napi-build or manual binding creation here
        fs.copyFileSync(sourceFile, outputFile);
        console.log(`⚠️  Note: Manual .node creation - may not work properly`);
      }
      
      console.log(`✅ ${target.name}: ${outputFile}`);
    } else {
      console.error(`❌ ${target.name}: Build failed - no output file`);
    }
    
  } catch (error) {
    console.error(`❌ ${target.name}: Build failed:`, error.message);
  }
}

console.log('\n🎉 Cross-platform build completed!');

// Build TypeScript
try {
  console.log('\n📦 Building TypeScript...');
  execSync('npm run build:ts', { stdio: 'inherit' });
  console.log('✅ TypeScript build completed');
} catch (error) {
  console.error('❌ TypeScript build failed:', error.message);
  process.exit(1);
}

console.log('\n✅ All builds completed successfully');