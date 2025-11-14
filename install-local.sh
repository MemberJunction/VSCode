#!/bin/bash

# Install the MemberJunction VSCode extension locally
# This script compiles and installs the extension for testing

set -e

echo "🔨 Compiling TypeScript..."
npm run compile

echo "📦 Creating VSIX package..."
npm run package

echo "🚀 Installing extension..."
code --install-extension memberjunction-vscode-0.1.0.vsix --force

echo "✅ Extension installed successfully!"
echo ""
echo "Next steps:"
echo "1. Reload your VSCode window (Cmd+Shift+P → 'Developer: Reload Window')"
echo "2. Open your MJ workspace"
echo "3. Look for 'MemberJunction Entities' in the Explorer sidebar"
echo ""
echo "To uninstall: code --uninstall-extension memberjunction.memberjunction-vscode"
