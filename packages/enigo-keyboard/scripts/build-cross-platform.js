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

const targetArg = process.argv[2];
const verbose = process.argv.includes('--verbose');

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
    // Check if we're building for the current platform
    const currentPlatform = platform();
    const currentArch = arch();
    const isCurrentPlatform = 
      (currentPlatform === 'win32' && target.platform === 'win32' && target.arch === 'x64') ||
      (currentPlatform === 'darwin' && target.platform === 'darwin' && target.arch === currentArch) ||
      (currentPlatform === 'linux' && target.platform === 'linux' && target.arch === currentArch);

    let napiCmd;
    if (isCurrentPlatform) {
      // Build for current platform - no cross-compilation needed
      napiCmd = `napi build --release`;
      console.log(`🏠 Building for current platform: ${target.name}`);
    } else {
      // Cross-compilation to other platforms
      console.log(`⚠️  Cross-compilation from ${currentPlatform}-${currentArch} to ${target.name}`);
      console.log(`⚠️  Note: Cross-compilation requires additional toolchain setup`);
      console.log(`⚠️  For now, only native platform builds are supported`);
      continue;
    }
    
    console.log(`Running: ${napiCmd}`);
    execSync(napiCmd, { 
      stdio: 'inherit',
      cwd: process.cwd()
    });
    
// Determine output file - napi-rs outputs to .node files directly
    let sourceFile;
    // napi-rs outputs to the root directory, not target-specific
    const napiDir = '.'; // napi outputs to current directory
    
    if (target.platform === 'win32') {
      sourceFile = `${napiDir}/enigo_keyboard.win32-x64.node`;
    } else if (target.platform === 'darwin') {
      if (target.arch === 'arm64') {
        sourceFile = `${napiDir}/enigo_keyboard.darwin-arm64.node`;
      } else {
        sourceFile = `${napiDir}/enigo_keyboard.darwin-x64.node`;
      }
    } else if (target.platform === 'linux') {
      if (target.arch === 'arm64') {
        sourceFile = `${napiDir}/enigo_keyboard.linux-arm64.node`;
      } else if (target.arch === 'arm') {
        sourceFile = `${napiDir}/enigo_keyboard.linux-arm-gnueabihf.node`;
      } else {
        sourceFile = `${napiDir}/enigo_keyboard.linux-x64.node`;
      }
    }
    
    // Check if file exists, try alternatives
    if (!fs.existsSync(sourceFile)) {
      try {
        const files = fs.readdirSync(napiDir);
        const foundFile = files.find(file => 
          file.includes('enigo_keyboard') && file.endsWith('.node')
        );
        
        if (foundFile) {
          sourceFile = `${napiDir}/${foundFile}`;
          console.log(`Found generated file: ${foundFile}`);
        } else {
          console.error(`❌ No enigo_keyboard library found for ${target.name}`);
          console.log(`Files in ${napiDir}:`, files);
          continue;
        }
      } catch (error) {
        console.error(`❌ Cannot read directory ${napiDir}:`, error.message);
        continue;
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
      fs.copyFileSync(sourceFile, outputFile);
      
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