import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const platform = process.platform;
const arch = process.arch;
const isWindows = platform === 'win32';
const isUnix = platform === 'darwin' || platform === 'linux';

console.log(`Building native module for CI: ${platform}-${arch}`);
console.log(`Using build method: ${isWindows ? 'cargo (Windows)' : 'napi-rs CLI (Unix)'}`);

try {
  if (isWindows) {
    // Windows: Use cargo directly
    buildWithCargo();
  } else if (isUnix) {
    // Unix (macOS, Linux): Use napi-rs CLI
    buildWithNapi();
  } else {
    console.error(`❌ Unsupported platform: ${platform}`);
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}

function buildWithCargo() {
  console.log('\n🔨 Building with cargo (Windows)...');
  
  try {
    // Force verbose output to see compilation details
    execSync('cargo build --release --target-dir target --verbose', { stdio: 'inherit' });
    
    // Determine the output file based on platform
    let sourceFile = 'target/release/enigo_keyboard.dll';
    
    // Check if the expected file exists
    if (!fs.existsSync(sourceFile)) {
      console.log(`Expected file ${sourceFile} not found, listing target/release directory:`);
      const files = fs.readdirSync('target/release');
      console.log('Files in target/release:', files);
      
      // Try to find any file that matches our pattern
      const foundFile = files.find(file => file.includes('enigo_keyboard'));
      
      if (foundFile) {
        sourceFile = `target/release/${foundFile}`;
        console.log(`Using found file: ${sourceFile}`);
      } else {
        console.error('❌ No enigo_keyboard library found in target/release');
        process.exit(1);
      }
    }
    
    if (fs.existsSync(sourceFile)) {
      copyToDistribution(sourceFile);
      console.log('✅ Cargo build completed');
    } else {
      console.error('❌ No native library found after build');
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Cargo build failed:', error.message);
    process.exit(1);
  }
}

function buildWithNapi() {
  console.log('\n🔨 Building with napi-rs CLI (Unix)...');
  
  try {
    // Use napi build for Unix systems
    execSync('napi build --release', { stdio: 'inherit' });
    
    // Find .node file in root directory (napi build puts it there)
    const rootNodeFiles = fs.readdirSync('.').filter(f => f.endsWith('.node'));
    if (rootNodeFiles.length === 0) {
      console.error('❌ No .node file found in root directory after napi build');
      console.error('   Expected file like enigo_keyboard.node');
      process.exit(1);
    }
    
    const nodeFile = rootNodeFiles[0];
    console.log(`✅ Found native binary: ${nodeFile}`);
    
    // Compile TypeScript to generate dist directory
    console.log('\n📦 Compiling TypeScript...');
    execSync('npm run build:ts', { stdio: 'inherit' });
    
    // Verify dist directory exists
    const distDir = './dist';
    if (!fs.existsSync(distDir)) {
      console.error('❌ dist directory not found after TypeScript compilation');
      process.exit(1);
    }
    
    // Copy .node file to dist directory
    const sourceFile = `./${nodeFile}`;
    const distNodeFile = path.join(distDir, nodeFile);
    fs.copyFileSync(sourceFile, distNodeFile);
    console.log(`✅ Copied ${nodeFile} to dist/`);
    
    // Sign binary on macOS
    if (platform === 'darwin') {
      signMacOSBinary(sourceFile);
      signMacOSBinary(distNodeFile);
    }
    
    console.log('✅ napi build completed');
  } catch (error) {
    console.error('❌ napi build failed:', error.message);
    process.exit(1);
  }
}

function signMacOSBinary(filePath) {
  const devIdentity = process.env.MACOS_SIGN_IDENTITY;
  
  if (!devIdentity) {
    console.warn(`\n⚠️  Skipping code signing for ${filePath}`);
    console.warn('   No MACOS_SIGN_IDENTITY certificate provided.');
    console.warn('   The binary may not load on macOS. Please provide a signing certificate if needed.');
    return;
  }
  
  console.log(`\n📝 Signing macOS binary: ${filePath}`);
  console.log(`   Using identity: ${devIdentity}`);
  
  try {
    execSync(`codesign --force --sign ${devIdentity} "${filePath}"`, { stdio: 'inherit' });
    console.log(`✅ Signed: ${filePath}`);
  } catch (error) {
    console.error(`❌ Signing failed: ${error.message}`);
    console.error('   The binary cannot be used on macOS without a valid signature.');
    process.exit(1);
  }
}

function copyToDistribution(sourceFile) {
  // Ensure dist directory exists
  if (!fs.existsSync('./dist')) {
    fs.mkdirSync('./dist', { recursive: true });
  }
  
  // Copy to root as .node
  fs.copyFileSync(sourceFile, './enigo_keyboard.node');
  
  // Copy to dist as .node
  fs.copyFileSync(sourceFile, './dist/enigo_keyboard.node');
  
  console.log('✅ Native module copied to dist/ and root');
}

// TypeScript build (common for all platforms)
console.log('\n📦 Building TypeScript...');
try {
  execSync('npm run build:ts', { stdio: 'inherit' });
  console.log('✅ TypeScript build completed');
  console.log('\n✅ All builds completed successfully');
} catch (error) {
  console.error('❌ TypeScript build failed:', error.message);
  process.exit(1);
}