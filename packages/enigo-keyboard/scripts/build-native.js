const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const platform = process.platform;
const arch = process.arch;

console.log(`Building native module for ${platform}-${arch}`);

// Helper function to safely copy file with retry
function safeCopy(src, dest, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
      fs.copyFileSync(src, dest);
      return true;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Retry ${i + 1} for copying ${src} to ${dest}...`);
      // Wait a bit before retry
      const start = Date.now();
      while (Date.now() - start < 1000) {
        // Wait 1 second
      }
    }
  }
  return false;
}

try {
  // Try to use napi build first
  console.log('Attempting napi build...');
  execSync('npm run build:napi', { stdio: 'inherit' });
  
  // Check if .node file exists
  if (fs.existsSync('./enigo_keyboard.node')) {
    console.log('✅ Native module built successfully with napi');
    process.exit(0);
  }
} catch (error) {
  console.log('Napi build failed, falling back to cargo build...');
}

// Fallback to cargo build
try {
  console.log('Building with cargo...');
  execSync('cargo build --release --target-dir target', { stdio: 'inherit' });
  
  // Determine the output file name based on platform
  let sourceFile;
  if (platform === 'win32') {
    sourceFile = 'target/release/enigo_keyboard.dll';
  } else if (platform === 'darwin') {
    sourceFile = 'target/release/enigo_keyboard.dylib';
  } else {
    sourceFile = 'target/release/enigo_keyboard.so';
  }
  
  if (fs.existsSync(sourceFile)) {
    // Ensure dist directory exists
    if (!fs.existsSync('./dist')) {
      fs.mkdirSync('./dist');
    }
    
    // Copy to root as .node
    safeCopy(sourceFile, './enigo_keyboard.node');
    
    // Copy to dist as .node
    safeCopy(sourceFile, './dist/enigo_keyboard.node');
    
    console.log('✅ Native module built successfully with cargo');
    process.exit(0);
  } else {
    console.error('❌ No native library found after build');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Cargo build failed:', error.message);
  process.exit(1);
}