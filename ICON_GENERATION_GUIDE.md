# 🖼️ TRUSTBOT Icon Generation Guide

## 📋 Overview
This guide explains how to properly generate icons for all platforms (macOS, Windows, Linux) to ensure they display correctly in the packaged Electron app.

## 🍎 macOS Icon Generation

### Problem Solved
- Icons with transparency were displaying as blank/empty in packaged macOS app
- `electron-icon-maker` wasn't creating proper ICNS files for macOS with correct transparency

### Solution: Use Native macOS Tools

```bash
# Step 1: Create iconset directory
mkdir -p MyIcon.iconset

# Step 2: Generate all required sizes with sips
sips -z 16 16 source.png --out MyIcon.iconset/icon_16x16.png
sips -z 32 32 source.png --out MyIcon.iconset/icon_16x16@2x.png
sips -z 32 32 source.png --out MyIcon.iconset/icon_32x32.png
sips -z 64 64 source.png --out MyIcon.iconset/icon_32x32@2x.png
sips -z 128 128 source.png --out MyIcon.iconset/icon_128x128.png
sips -z 256 256 source.png --out MyIcon.iconset/icon_128x128@2x.png
sips -z 256 256 source.png --out MyIcon.iconset/icon_256x256.png
sips -z 512 512 source.png --out MyIcon.iconset/icon_256x256@2x.png
sips -z 512 512 source.png --out MyIcon.iconset/icon_512x512.png
sips -z 1024 1024 source.png --out MyIcon.iconset/icon_512x512@2x.png

# Step 3: Convert to ICNS
iconutil -c icns MyIcon.iconset -o assets/icon.icns
```

### Requirements
- High-quality 1024×1024 PNG source image with transparency
- macOS system with `sips` and `iconutil` tools (built-in)
- Proper naming convention for iconset files

## 🪟 Windows Icon Generation

### Using electron-icon-maker

```bash
# Install electron-icon-maker if not already installed
npm install electron-icon-maker -g

# Generate Windows ICO file
electron-icon-maker --input=source.png --output=./assets
```

### Requirements
- High-quality PNG source image (512×512 or larger recommended)
- Supports transparency
- Creates multi-resolution ICO file automatically

## 🐧 Linux Icon Generation

### Using electron-icon-maker

```bash
# Same command as Windows - creates PNG icon
electron-icon-maker --input=source.png --output=./assets
```

### Requirements
- PNG format (standard for Linux)
- 512×512 recommended size
- Transparency supported

## 🔧 Automated Generation Script

Use the included `generate-icons.sh` script for automatic generation:

```bash
# Generate icons from default source
./generate-icons.sh

# Generate icons from custom source
./generate-icons.sh path/to/your/source.png
```

### What the Script Does
1. **macOS**: Uses native `sips` and `iconutil` for perfect ICNS generation
2. **Windows/Linux**: Uses `electron-icon-maker` for ICO and PNG generation
3. **Cleanup**: Removes temporary files automatically
4. **Verification**: Shows generated file sizes and locations

## 📐 Icon Size Requirements

### Source Image Specifications
- **Format**: PNG with transparency
- **Size**: 1024×1024 pixels (minimum)
- **Quality**: High resolution, clean edges
- **Background**: Transparent or solid color

### Generated Sizes

#### macOS (ICNS)
- 16×16, 32×32, 128×128, 256×256, 512×512
- Retina versions (@2x) for each size
- Total: 10 different resolutions

#### Windows (ICO)
- 16×16, 24×24, 32×32, 48×48, 64×64, 128×128, 256×256
- Multiple color depths supported
- Embedded in single .ico file

#### Linux (PNG)
- Single 512×512 PNG file
- Used by most Linux desktop environments
- Scalable by system as needed

## 🎨 Design Guidelines

### Best Practices
- **Simple design**: Avoid complex details that don't scale well
- **High contrast**: Ensure visibility on light and dark backgrounds
- **Consistent branding**: Match your app's visual identity
- **Test at small sizes**: Verify 16×16 version is recognizable

### Common Issues
- **Too much detail**: Complex icons become unclear at small sizes
- **Poor contrast**: Icons invisible on certain backgrounds
- **Jagged edges**: Low-quality source images create pixelated results
- **Missing transparency**: Solid backgrounds look unprofessional

## 🔍 Testing Your Icons

### macOS Testing
```bash
# View ICNS file in Finder
open assets/icon.icns

# Test in app
npm run build:mac
open dist/mac/TRUSTBOT.app
```

### Windows Testing
```bash
# Build and test
npm run build:win
# Check dist/win-unpacked/TRUSTBOT.exe icon
```

### Linux Testing
```bash
# Build and test
npm run build:linux
# Check dist/linux-unpacked/trustbot icon
```

## 🛠️ Troubleshooting

### macOS Issues
- **Blank icons**: Use native tools instead of electron-icon-maker
- **Wrong sizes**: Ensure all iconset files are present
- **Cache issues**: Clear icon cache with `sudo find /private/var/folders/ -name com.apple.dock.iconcache -delete`

### Windows Issues
- **Pixelated icons**: Use higher resolution source image
- **Missing icon**: Check ICO file is properly embedded
- **Wrong format**: Ensure ICO format, not PNG

### Linux Issues
- **Icon not showing**: Check PNG file permissions
- **Wrong size**: Use 512×512 or larger source
- **Desktop integration**: Some environments need manual icon cache refresh

## 📋 Icon Checklist

### Before Building
- [ ] Source image is 1024×1024 PNG with transparency
- [ ] Run `./generate-icons.sh` successfully
- [ ] Verify all three icon files exist (icns, ico, png)
- [ ] Test icons at different sizes visually

### After Building
- [ ] Check packaged app shows correct icon
- [ ] Test on target operating systems
- [ ] Verify icon appears in file managers
- [ ] Confirm icon shows in taskbar/dock

Your app icons are now ready for professional distribution! 🎨
