# Quick Install Guide

## 🚀 Fastest Way (Recommended)

```bash
# From the MJVSCode directory:
./install-local.sh
```

Then reload VSCode: `Cmd+Shift+P` → "Developer: Reload Window"

---

## 📋 All Methods Compared

| Method | Best For | Reload After Change? | Debugging? |
|--------|----------|---------------------|------------|
| **VSIX Install** | Testing, Daily Use | Yes (reinstall) | No |
| **Symlink** | Active Development | Yes (window reload) | Limited |
| **Dev Host** | Debugging, First Test | Yes (Cmd+R) | Full |

---

## Method 1: VSIX Install (Testing & Daily Use)

**Install:**
```bash
./install-local.sh
```

**Reload:** Cmd+Shift+P → "Developer: Reload Window"

**Update after changes:**
```bash
./install-local.sh  # Recompiles and reinstalls
# Then reload VSCode
```

**Uninstall:**
```bash
code --uninstall-extension memberjunction.memberjunction-vscode
```

---

## Method 2: Symlink (Active Development)

**Setup once:**
```bash
npm install
npm run compile
ln -s $(pwd) ~/.vscode/extensions/memberjunction.memberjunction-vscode-0.1.0
```

**Start watch mode:**
```bash
npm run watch
```

**After making changes:**
- Save file (watch auto-compiles)
- Reload VSCode: Cmd+Shift+P → "Developer: Reload Window"

**Cleanup:**
```bash
rm ~/.vscode/extensions/memberjunction.memberjunction-vscode-0.1.0
```

---

## Method 3: Extension Development Host (Debugging)

**Start:**
1. Open MJVSCode folder in VSCode
2. Press `F5`
3. New window opens (Extension Development Host)
4. In new window, open your MJ workspace

**After making changes:**
- Press `Cmd+R` in Extension Development Host window
- Or: Cmd+Shift+P → "Developer: Reload Window"

**Stop:**
- Close Extension Development Host window
- Or: Press `Shift+F5` in main window

---

## ✅ Verify Installation

Once installed, check:

1. **Extension List:**
   ```bash
   code --list-extensions | grep memberjunction
   ```
   Should show: `memberjunction.memberjunction-vscode`

2. **In VSCode:**
   - Open MJ workspace
   - Look for "MemberJunction Entities" in Explorer sidebar
   - Check status bar (bottom-left): `$(database) MJ: X entities`
   - View → Output → Select "MemberJunction"

3. **Test Entity Explorer:**
   - Expand "Core Entities" - should see ~15+ entities
   - Expand "Custom Entities" - should see your entities
   - Click an entity - should open TypeScript file

---

## 🛠 Troubleshooting

### Extension not in list
```bash
# Reinstall
code --uninstall-extension memberjunction.memberjunction-vscode
./install-local.sh
```

### Extension not activating
```bash
# Make sure MJ workspace has dependencies
cd /path/to/MJ_FRESH
npm install
npm run build
```

### Entities not showing
```bash
# Check if core-entities is installed
cd /path/to/MJ_FRESH
npm install @memberjunction/core-entities --save
```

### Changes not reflected
- VSIX: Run `./install-local.sh` again
- Symlink: Reload VSCode (Cmd+Shift+P → Reload Window)
- Dev Host: Press Cmd+R in Extension Development Host

---

## 📝 Quick Commands

```bash
# Install
./install-local.sh

# Build VSIX manually
npm run compile
npm run package

# Install VSIX manually
code --install-extension memberjunction-vscode-0.1.0.vsix --force

# Uninstall
code --uninstall-extension memberjunction.memberjunction-vscode

# List extensions
code --list-extensions | grep memberjunction

# Start watch mode (for symlink method)
npm run watch

# Compile once
npm run compile
```

---

## 💡 My Recommendation

**For you right now:**
1. Start with **Extension Development Host** (Method 3)
   - Press F5, test everything works
2. Then switch to **VSIX Install** (Method 1)
   - Run `./install-local.sh`
   - Use in your normal workflow
3. When adding features, use **Symlink** (Method 2)
   - Quick iteration, no reinstall needed

---

See [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md) for detailed explanations of each method.
