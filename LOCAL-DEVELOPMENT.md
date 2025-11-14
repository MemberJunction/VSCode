# Local Development & Installation Guide

This guide explains how to use the MemberJunction VSCode extension in your main MJ workspace during development, before it's published to npm.

## Quick Install (Recommended)

Use the provided install script:

```bash
./install-local.sh
```

Then **reload your VSCode window**:
- Press `Cmd+Shift+P` (or `Ctrl+Shift+P` on Windows/Linux)
- Type "Developer: Reload Window"
- Press Enter

Open your MJ workspace and the extension should be active!

---

## Manual Installation Options

### Option 1: Install from VSIX (Best for Testing)

This installs the extension just like it came from the marketplace:

```bash
# 1. Build the VSIX
npm install
npm run package

# 2. Install it
code --install-extension memberjunction-vscode-0.1.0.vsix --force

# 3. Reload VSCode
# Cmd+Shift+P → "Developer: Reload Window"
```

**Pros:**
- ✅ Installs globally - works in all VSCode windows
- ✅ Persists across VSCode restarts
- ✅ Most realistic testing (like a real user)
- ✅ Can test in your actual MJ workspace

**Cons:**
- ❌ Need to reinstall after every code change
- ❌ Two-step process (package + install)

**When to use:**
- When you want to test in your real MJ workspace
- When testing is more important than rapid iteration
- For final testing before publishing

---

### Option 2: Symlink Development Version (Best for Active Development)

Create a symlink in VSCode's extensions directory:

```bash
# 1. Compile once
npm install
npm run compile

# 2. Find your VSCode extensions directory
# macOS:
ln -s /Users/amith/Dropbox/develop/Mac/MJVSCode ~/.vscode/extensions/memberjunction.memberjunction-vscode-0.1.0

# Windows:
# mklink /D %USERPROFILE%\.vscode\extensions\memberjunction.memberjunction-vscode-0.1.0 C:\path\to\MJVSCode

# Linux:
# ln -s /path/to/MJVSCode ~/.vscode/extensions/memberjunction.memberjunction-vscode-0.1.0

# 3. Run watch mode for continuous compilation
npm run watch

# 4. Reload VSCode
# Cmd+Shift+P → "Developer: Reload Window"
```

**Pros:**
- ✅ Changes reflect immediately (after reload)
- ✅ Use `npm run watch` for auto-compilation
- ✅ Works in all VSCode windows
- ✅ No need to reinstall after changes

**Cons:**
- ❌ Must manually reload VSCode after changes
- ❌ Need to remember to unlink later
- ❌ Symlink setup is platform-specific

**When to use:**
- When actively developing features
- When making frequent code changes
- When you want quick iteration

---

### Option 3: Extension Development Host (Best for Debugging)

Use VSCode's built-in extension development tools:

```bash
# 1. Open MJVSCode in VSCode
code /Users/amith/Dropbox/develop/Mac/MJVSCode

# 2. Press F5 (or Debug → Start Debugging)
# This opens a new "Extension Development Host" window

# 3. In the new window, open your MJ workspace
# File → Open Folder → /path/to/MJ_FRESH
```

**Pros:**
- ✅ Full debugging support (breakpoints, watches, etc.)
- ✅ See all console logs in Debug Console
- ✅ Auto-recompiles on save (with watch task)
- ✅ Can reload with Cmd+R in Extension Host

**Cons:**
- ❌ Separate window for development
- ❌ Extension only works in that window
- ❌ Not your normal VSCode setup

**When to use:**
- When debugging issues
- When developing new features
- When you need detailed logs
- First-time testing

---

## Recommended Workflow

Here's the workflow I recommend:

### Phase 1: Initial Development & Debugging
Use **Extension Development Host** (Option 3):
1. Open MJVSCode folder in VSCode
2. Press F5
3. Test in Extension Development Host window
4. Iterate quickly with hot reload

### Phase 2: Integration Testing
Use **VSIX Install** (Option 1):
1. Run `./install-local.sh`
2. Test in your real MJ workspace
3. Validate everything works as expected

### Phase 3: Active Feature Development
Use **Symlink** (Option 2):
1. Set up symlink once
2. Run `npm run watch`
3. Make changes, reload VSCode
4. Quick iteration cycle

---

## Workflow Commands

### For Active Development (Symlink Approach)

```bash
# Terminal 1: Run watch mode (auto-compile on save)
cd /Users/amith/Dropbox/develop/Mac/MJVSCode
npm run watch

# Terminal 2: Work in your MJ repo
cd /path/to/MJ_FRESH
# ... do your normal MJ development

# In VSCode:
# After making changes to extension code:
# Cmd+Shift+P → "Developer: Reload Window"
```

### For Testing (VSIX Approach)

```bash
# In extension repo
cd /Users/amith/Dropbox/develop/Mac/MJVSCode

# Make changes, then:
./install-local.sh

# In VSCode:
# Cmd+Shift+P → "Developer: Reload Window"
```

---

## Updating After Code Changes

### If using VSIX install:
```bash
./install-local.sh
# Then reload VSCode
```

### If using Symlink:
```bash
# If watch is running: just save files and reload VSCode
# If not: npm run compile, then reload VSCode
```

### If using Extension Development Host:
```bash
# In Extension Development Host window:
# Cmd+R (or Ctrl+R)
# Or: Cmd+Shift+P → "Developer: Reload Window"
```

---

## Uninstalling the Extension

### If installed via VSIX:
```bash
code --uninstall-extension memberjunction.memberjunction-vscode
```

### If using symlink:
```bash
# macOS/Linux:
rm ~/.vscode/extensions/memberjunction.memberjunction-vscode-0.1.0

# Windows:
# rmdir %USERPROFILE%\.vscode\extensions\memberjunction.memberjunction-vscode-0.1.0
```

### If using Extension Development Host:
Just close the Extension Development Host window (no uninstall needed).

---

## Testing the Extension

Once installed (any method), test these features:

### 1. Entity Explorer
- Open your MJ workspace
- Look for "MemberJunction Entities" in Explorer sidebar
- Expand "Core Entities" - should see entities like "Applications", "Entities", etc.
- Expand "Custom Entities" - should see your custom entities (if any)
- Click on an entity - should open the TypeScript file

### 2. Status Bar
- Look at bottom-left status bar
- Should see: `$(database) MJ: X entities`
- Click it - should refresh entity explorer

### 3. IntelliSense (requires metadata files)
- Create a test file: `metadata/test.json`
- Start typing:
  ```json
  {
    "EntityName": "
  ```
- Should see auto-completion for entity names
- Type an entity name and hover over it - should see tooltip

### 4. Validation
- In a metadata JSON file, add an invalid entity name
- Check Problems panel (View → Problems)
- Should see a warning about unknown entity

### 5. Output Logs
- View → Output
- Select "MemberJunction" from dropdown
- Should see initialization logs

---

## Troubleshooting

### Extension not appearing

**Check:**
1. Did you reload VSCode after install?
2. Is the extension installed? Run: `code --list-extensions | grep memberjunction`
3. Check Output panel (View → Output → MemberJunction) for errors

**Solution:**
```bash
# Uninstall and reinstall
code --uninstall-extension memberjunction.memberjunction-vscode
./install-local.sh
# Reload VSCode
```

### Extension installed but not activating

**Check:**
1. Are you in a valid MJ workspace?
2. Is `@memberjunction/core` installed in your workspace?
3. Check Developer Tools console: Help → Toggle Developer Tools

**Solution:**
Make sure your MJ workspace has been built:
```bash
cd /path/to/MJ_FRESH
npm install
npm run build
```

### Entities not showing

**Check:**
1. Is `@memberjunction/core-entities` installed?
2. Check Output panel for errors during initialization

**Solution:**
```bash
cd /path/to/MJ_FRESH
npm install @memberjunction/core-entities --save
```

### Changes not reflected

**If using VSIX:**
- Reinstall: `./install-local.sh`
- Reload: Cmd+Shift+P → "Developer: Reload Window"

**If using Symlink:**
- Check if watch is running: `npm run watch`
- Reload: Cmd+Shift+P → "Developer: Reload Window"

**If using Extension Development Host:**
- Reload Extension Host: Cmd+R in the Extension Development Host window

### TypeScript compilation errors

```bash
# Clean and rebuild
rm -rf dist
npm run compile
```

Check the output for specific errors.

---

## My Recommendation for You

Based on your situation, I recommend:

### For Initial Testing (Now):
Use **Extension Development Host** (Option 3):
1. Open MJVSCode in VSCode
2. Press F5
3. In Extension Development Host, open your MJ workspace
4. Test all features and verify they work

### For Daily Use (After Initial Testing):
Use **VSIX Install** (Option 1) with the install script:
1. Run `./install-local.sh` after each change
2. Reload your normal VSCode window
3. Continue your normal MJ development
4. Extension is available in all projects

### For Rapid Development (When Adding Features):
Use **Symlink** (Option 2) + Watch Mode:
1. Set up symlink once
2. Keep `npm run watch` running
3. Make changes, save, reload VSCode
4. Quick iteration without reinstalling

---

## Version Updates

When you bump the version in `package.json`:

```bash
# Update package.json version
# Then:
npm run package  # Creates new VSIX with new version

# Reinstall
code --install-extension memberjunction-vscode-0.2.0.vsix --force

# Or use the install script (update script for new version first)
./install-local.sh
```

---

## Next Steps

1. **Choose your preferred method** (I suggest starting with Extension Development Host)
2. **Test the extension** in your MJ workspace
3. **Report any issues** you find
4. **Iterate** on features as needed

Ready to test! Let me know which method you prefer and if you need help with any issues. 🚀
