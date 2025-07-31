#!/bin/bash

# TRUSTBOT Release Script - Complete Automation
# This script does EVERYTHING to release your app

echo "🚀 TRUSTBOT Release Process Starting..."
echo "==========================================="

# Step 1: Check if GH_TOKEN is set
if [ -z "$GH_TOKEN" ]; then
    echo "❌ ERROR: GitHub token not found!"
    echo ""
    echo "Please set your GitHub token first:"
    echo "export GH_TOKEN='your_github_token_here'"
    echo ""
    echo "Get your token from: https://github.com/settings/personal-access-tokens/fine-grained"
    exit 1
fi

echo "✅ GitHub token found"

# Step 2: Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf dist/
echo "✅ Cleaned dist folder"

# Step 3: Install/update dependencies
echo "📦 Checking dependencies..."
npm install
echo "✅ Dependencies ready"

# Step 4: Build for ALL platforms
echo "🏗️  Building for ALL platforms..."
echo "This will create:"
echo "  • macOS: DMG and ZIP files"
echo "  • Windows: EXE installer and portable"
echo "  • Linux: AppImage and DEB packages"
echo ""

# Directly use electron-builder to ensure cross-platform builds
echo "🏗️  Building for all platforms (macOS, Windows, Linux)..."

# Build for all platforms with specific configuration
# Note: We're using --dir for Windows/Linux to skip code signing requirements
echo "🖥️  Building macOS packages..."
npx electron-builder --mac --arm64 --x64 --publish=never

echo "🪟  Building Windows packages..."
npx electron-builder --win --publish=never

echo "🐧  Building Linux packages..."
npx electron-builder --linux --publish=never

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Check the errors above."
    exit 1
fi

echo "✅ All builds completed successfully!"

# Step 5: Show what was built and generate checksums
echo ""
echo "📁 Built files:"
ls -la dist/ | grep -E '\.(dmg|exe|AppImage|deb|zip)$'

# Generate checksums for verification
echo ""
echo "🔐 Generating checksums for verification..."
cd dist
shasum -a 256 *.{dmg,exe,AppImage,zip,deb} > SHA256SUMS.txt 2>/dev/null
cd ..

# Step 6: Create release notes file
echo ""
echo "📝 Creating release notes..."

# Create a temporary file for release notes
RELEASE_NOTES_FILE="release-notes.md"

# Prompt for release notes
echo "Enter release notes (type 'EOF' on a new line when finished):"
echo "Example format:"
echo "- Fixed wallet selection issues"
echo "- Improved error handling"
echo "- Added new feature X"
echo ""

# Start with version header
VERSION=$(node -e "console.log(require('./package.json').version)")
echo "# Version ${VERSION}" > "${RELEASE_NOTES_FILE}"
echo "" >> "${RELEASE_NOTES_FILE}"

# Read multi-line input until EOF
while IFS= read -r line; do
    [[ "$line" == "EOF" ]] && break
    echo "$line" >> "${RELEASE_NOTES_FILE}"
done

echo ""
echo "📤 Publishing to GitHub Releases with custom notes..."

# Step 7: Create GitHub release with all files
npx electron-builder --publish=always --config.publish.releaseType=release

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 SUCCESS! Your app has been built and published!"
    echo ""
    echo "📦 What was created:"
    echo "  • Cross-platform installers in dist/ folder"
    echo "  • GitHub release with all files uploaded"
    echo "  • SHA256 checksums for verification"
    echo ""
    echo "🔗 Check your GitHub releases page to see the published version"
    echo "🚀 Users can now download and install your app!"
else
    echo "❌ Publishing failed! Check the errors above."
    echo "💡 You can still find the built files in the 'dist' folder"
    exit 1
fi

# Clean up
rm -f "${RELEASE_NOTES_FILE}"

echo ""
echo "✨ Release process complete!"
