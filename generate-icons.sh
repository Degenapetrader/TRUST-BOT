#!/bin/bash

# TRUSTBOT Icon Generation Script
# This script generates icons for all platforms (macOS, Windows, Linux)

# Default source image
SOURCE="assets/logonewagain.png"

# Allow custom source image as argument
if [ ! -z "$1" ]; then
  SOURCE="$1"
fi

# Check if source image exists
if [ ! -f "$SOURCE" ]; then
  echo "❌ Error: Source image '$SOURCE' not found!"
  echo "Usage: ./generate-icons.sh [path/to/source.png]"
  exit 1
fi

echo "🖼️ Generating icons for all platforms from '$SOURCE'..."

# 1. macOS ICNS using native tools (best for transparency)
echo "🍎 Generating macOS icons..."
mkdir -p MyIcon.iconset
sips -z 16 16 "$SOURCE" --out MyIcon.iconset/icon_16x16.png
sips -z 32 32 "$SOURCE" --out MyIcon.iconset/icon_16x16@2x.png
sips -z 32 32 "$SOURCE" --out MyIcon.iconset/icon_32x32.png
sips -z 64 64 "$SOURCE" --out MyIcon.iconset/icon_32x32@2x.png
sips -z 128 128 "$SOURCE" --out MyIcon.iconset/icon_128x128.png
sips -z 256 256 "$SOURCE" --out MyIcon.iconset/icon_128x128@2x.png
sips -z 256 256 "$SOURCE" --out MyIcon.iconset/icon_256x256.png
sips -z 512 512 "$SOURCE" --out MyIcon.iconset/icon_256x256@2x.png
sips -z 512 512 "$SOURCE" --out MyIcon.iconset/icon_512x512.png
sips -z 1024 1024 "$SOURCE" --out MyIcon.iconset/icon_512x512@2x.png
iconutil -c icns MyIcon.iconset -o assets/icon.icns
echo "✅ macOS icon created: assets/icon.icns"

# 2. Windows & Linux icons using electron-icon-maker
echo "🪟 Generating Windows & Linux icons..."
npx electron-icon-maker --input="$SOURCE" --output=./assets
echo "✅ Windows icon created: assets/icon.ico"
echo "✅ Linux icon created: assets/icon.png"

# Clean up temporary files
rm -rf MyIcon.iconset
echo "🧹 Cleaned up temporary files"

echo ""
echo "🎉 All icons generated successfully!"
echo ""
echo "📋 Generated files:"
echo "  • assets/icon.icns  (macOS)"
echo "  • assets/icon.ico   (Windows)"
echo "  • assets/icon.png   (Linux)"
echo ""
echo "💡 Tip: Run 'npm run build' to create packaged apps with these icons!"
