#!/bin/bash
# Build the .mcpb bundle for distribution
# Usage: ./scripts/build-mcpb.sh

set -e

echo "Building blinkit-mcp bundle..."

# 1. Clean previous build
rm -rf dist/ bundle/ blinkit-mcp.mcpb

# 2. Compile TypeScript
echo "Compiling TypeScript..."
npx tsc -p tsconfig.build.json

# 3. Create bundle directory structure
echo "Creating bundle structure..."
mkdir -p bundle/server
cp -r dist/* bundle/server/

# 4. Copy package.json and install production deps into bundle
cp package.json bundle/
cd bundle
npm install --production --ignore-scripts 2>/dev/null || pnpm install --prod --ignore-scripts 2>/dev/null
cd ..

# 5. Copy manifest
cp manifest.json bundle/

# 6. Install Playwright browsers into bundle
echo "Installing Playwright chromium browser..."
cd bundle
npx playwright install chromium 2>/dev/null || echo "Warning: Playwright browser install failed. Users will need to run 'npx playwright install chromium' manually."
cd ..

# 7. Pack the bundle
echo "Packing .mcpb bundle..."
if command -v mcpb &>/dev/null; then
  cd bundle && mcpb pack && mv *.mcpb ../blinkit-mcp.mcpb && cd ..
else
  # Fallback: create zip manually (mcpb files are just zips)
  cd bundle && zip -r ../blinkit-mcp.mcpb . -x "*.DS_Store" && cd ..
fi

# 8. Cleanup
rm -rf bundle/

echo ""
echo "Done! Bundle created: blinkit-mcp.mcpb"
echo "Size: $(du -h blinkit-mcp.mcpb | cut -f1)"
echo ""
echo "To install: Open blinkit-mcp.mcpb with Claude Desktop"
