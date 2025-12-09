import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const platform = process.platform;
const arch = process.arch;

console.log(`Building native module for CI: ${platform}-${arch}`);

// Build with cargo
try {
  console.log('Building with cargo...');
  // Force verbose output to see compilation details
  execSync('cargo build --release --target-dir target --verbose', { stdio: 'inherit' });
  
  // Determine the output file based on platform
  let sourceFile;
  if (platform === 'win32') {
    sourceFile = 'target/release/enigo_keyboard.dll';
  } else if (platform === 'darwin') {
    sourceFile = 'target/release/enigo_keyboard.dylib';
  } else {
    sourceFile = 'target/release/enigo_keyboard.so';
  }
  
  // Check if the expected file exists, if not, list all files in target/release
  if (!fs.existsSync(sourceFile)) {
    console.log(`Expected file ${sourceFile} not found, listing target/release directory:`);
    const files = fs.readdirSync('target/release');
    console.log('Files in target/release:', files);
    
    // Try to find any file that matches our pattern
    const foundFile = files.find(file => 
      file.includes('enigo_keyboard') || 
      (file.startsWith('libenigo_keyboard') && (file.endsWith('.dylib') || file.endsWith('.so')))
    );
    
    if (foundFile) {
      sourceFile = `target/release/${foundFile}`;
      console.log(`Using found file: ${sourceFile}`);
    } else {
      console.error('❌ No enigo_keyboard library found in target/release');
      process.exit(1);
    }
  }
  
  if (fs.existsSync(sourceFile)) {
    // Ensure dist directory exists
    if (!fs.existsSync('./dist')) {
      fs.mkdirSync('./dist', { recursive: true });
    }
    
    // Copy to root as .node
    fs.copyFileSync(sourceFile, './enigo_keyboard.node');
    
    // Copy to dist as .node
    fs.copyFileSync(sourceFile, './dist/enigo_keyboard.node');
    
    console.log('✅ Native module built successfully');
    
    // Build TypeScript
    console.log('Building TypeScript...');
    execSync('npm run build:ts', { stdio: 'inherit' });
    
    console.log('✅ All builds completed successfully');
  } else {
    console.error('❌ No native library found after build');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}