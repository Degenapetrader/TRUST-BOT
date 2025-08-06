#!/usr/bin/env node

/**
 * Post-build script to fix file permissions for bot files in packaged Electron apps
 * This ensures that .mjs bot files have execute permissions in the unpacked directory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Running post-build script to fix file permissions...');

// Define the paths to check
const platforms = [
  { name: 'macOS x64', path: 'dist/mac/TRUSTBOT.app/Contents/Resources/app.asar.unpacked' },
  { name: 'macOS ARM64', path: 'dist/mac-arm64/TRUSTBOT.app/Contents/Resources/app.asar.unpacked' },
  { name: 'Windows', path: 'dist/win-unpacked/resources/app.asar.unpacked' },
  { name: 'Linux', path: 'dist/linux-unpacked/resources/app.asar.unpacked' }
];

let fixedCount = 0;

platforms.forEach(platform => {
  const unpackedPath = platform.path;
  
  if (fs.existsSync(unpackedPath)) {
    console.log(`📁 Processing ${platform.name} build...`);
    
    try {
      // Find all .mjs files in the unpacked directory
      const mjsFiles = fs.readdirSync(unpackedPath).filter(file => file.endsWith('.mjs'));
      
      mjsFiles.forEach(file => {
        const filePath = path.join(unpackedPath, file);
        const stats = fs.statSync(filePath);
        
        // Check if file has execute permissions
        if (!(stats.mode & parseInt('100', 8))) {
          console.log(`  🔐 Fixing permissions for ${file}...`);
          fs.chmodSync(filePath, stats.mode | parseInt('755', 8));
          fixedCount++;
        } else {
          console.log(`  ✅ ${file} already has correct permissions`);
        }
      });
      
      console.log(`  ✅ ${platform.name} build processed successfully`);
      
    } catch (error) {
      console.error(`  ❌ Error processing ${platform.name}:`, error.message);
    }
  } else {
    console.log(`  ⏭️  ${platform.name} build not found, skipping...`);
  }
});

console.log('');
console.log(`🎉 Post-build processing complete!`);
console.log(`📊 Fixed permissions for ${fixedCount} files`);

if (fixedCount > 0) {
  console.log('');
  console.log('✅ All bot files now have proper execute permissions');
  console.log('🚀 Your packaged app is ready for distribution!');
}
