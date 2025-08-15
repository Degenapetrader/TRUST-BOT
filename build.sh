#!/bin/bash

echo "🚀 Building VIRTUAL Trading Bot..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/

# Build for current platform
echo "🔨 Building for current platform..."
npm run build

echo "✅ Build complete! Check the 'dist' folder for your executable."
echo ""
echo "📦 Available build commands:"
echo "  npm run build:mac    - Build for macOS (DMG + ZIP)"
echo "  npm run build:win    - Build for Windows (NSIS + Portable)"
echo "  npm run build:linux  - Build for Linux (AppImage + DEB)"
echo "  npm run publish      - Build and publish to GitHub releases"
