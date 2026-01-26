# Publishing MemberJunction VSCode Extension to Marketplace

This guide outlines the complete process for publishing the MemberJunction extension to the Visual Studio Code Marketplace.

## Prerequisites

Before you can publish, you need organizational access:

### 1. Azure DevOps Organization Account

**For Company/Organization Publishing:**

#### Option A: Use Existing Company Azure DevOps Organization
1. Check if MemberJunction already has an Azure DevOps organization
2. Request to be added as a member/admin
3. You'll need **Project Collection Administrator** or **Organization Administrator** permissions

#### Option B: Create New Organization for MemberJunction
1. Go to https://dev.azure.com
2. Sign in with your work Microsoft account
3. Click **+ New organization**
4. Name it: `memberjunction` or `MemberJunction`
5. Invite team members who need publishing access

**Key Point**: The Azure DevOps organization should be owned by the company, not an individual. This ensures continuity if team members leave.

### 2. Visual Studio Marketplace Publisher Account

**IMPORTANT**: Check if the publisher already exists!

1. Search for existing publisher at: https://marketplace.visualstudio.com/search?term=memberjunction
2. If `memberjunction` publisher exists:
   - Contact the current owner/admin to add you
   - You'll need **Owner** or **Creator** role

3. If creating new publisher:
   - Go to https://marketplace.visualstudio.com/manage
   - Sign in with **company Microsoft account** (not personal)
   - Click **Create publisher**
   - Fill in the form:
     - **Publisher ID**: `memberjunction` (must be globally unique)
     - **Publisher display name**: "MemberJunction"
     - **Email**: Company contact email (e.g., support@memberjunction.org)
     - **Description**: "Official extensions for MemberJunction platform"
     - **Logo**: Upload MemberJunction logo (200x200 PNG recommended)

**Best Practice**: Have multiple team members with publisher access (avoid single point of failure).

### 3. Personal Access Token (PAT) - Organization Level

**For company publishing, coordinate with your DevOps admin:**

#### If you have Organization Admin access:

1. Go to https://dev.azure.com/{your-org}
2. Click **Organization settings** (bottom left)
3. Under **Security**, go to **Personal access tokens**
4. Click **+ New Token**
5. Configure the token:
   - **Name**: "VSCode Extension Publishing - [Your Name]"
   - **Organization**: Select MemberJunction organization
   - **Expiration**: Custom defined (1 year recommended, coordinate renewal)
   - **Scopes**:
     - Select **Custom defined**
     - Check **Marketplace** → **Manage** (includes Publish)
6. Click **Create**
7. **CRITICAL**: Copy the token immediately - you cannot view it again!
8. Store securely using company-approved method:
   - Azure Key Vault (recommended for companies)
   - Company password manager (1Password, LastPass, etc.)
   - Secure notes in company wiki

#### If you DON'T have admin access:

Request that your DevOps admin:
1. Create a PAT for you, OR
2. Grant you permissions to create your own PAT, OR
3. Add you to a group that has marketplace publishing rights

### 4. Coordinate with Team

Before publishing, verify:
- [ ] Who currently has publisher access?
- [ ] Is there an existing extension with this name?
- [ ] What's the company's versioning/release process?
- [ ] Who approves releases (code review, testing)?
- [ ] Where should PATs be stored?
- [ ] Who maintains the extension after publication?

### 5. Install Publishing Tool
```bash
npm install -g @vscode/vsce
```

## Organizational Governance

### Roles & Responsibilities

**Publisher Owner** (1-2 people):
- Create and manage the publisher account
- Add/remove team members
- Final approval for publications
- Typically: CTO, Engineering Lead, DevOps Manager

**Extension Maintainers** (2-4 people):
- Can publish updates
- Manage versions and releases
- Respond to user issues/reviews
- Typically: Senior Developers, Product Managers

**Contributors**:
- Can submit PRs and features
- Cannot publish directly
- Code reviewed by maintainers

### Publishing Workflow (Recommended)

For companies, establish a release process:

1. **Development**: Feature branches → PR → Review → Merge to `main`
2. **Testing**: Test in Extension Development Host
3. **Staging**: Package `.vsix` and share with team for testing
4. **Approval**: Get sign-off from product/engineering lead
5. **Release**: Designated maintainer publishes to marketplace
6. **Communication**: Announce release to team/users

### Token Management Best Practices

**DO**:
- ✅ Use company-managed Azure DevOps organization
- ✅ Store PATs in company-approved secure storage
- ✅ Set expiration dates (1 year max, 90 days recommended)
- ✅ Have multiple people with publishing rights
- ✅ Document who has tokens and when they expire
- ✅ Rotate tokens before expiration
- ✅ Revoke tokens when team members leave

**DON'T**:
- ❌ Store PATs in code or config files
- ❌ Share PATs via email or Slack
- ❌ Use personal accounts for company extensions
- ❌ Leave tokens without expiration
- ❌ Give publishing access to everyone

### Token Rotation Schedule

Set up a rotation calendar:
- **90 days before expiration**: Create new token
- **30 days before**: Test new token with `vsce login`
- **7 days before**: Update CI/CD pipelines (if applicable)
- **On expiration**: Revoke old token
- **Document**: Update team wiki with new token location

## Checking Existing Company Setup

Before creating anything new, **verify what already exists**:

### 1. Check for Existing Publisher

```bash
# Search for MemberJunction extensions
vsce show memberjunction.memberjunction-vscode
```

Or visit: https://marketplace.visualstudio.com/search?term=memberjunction&target=VSCode

**If publisher exists**:
- Contact current owner (check publisher page for contact info)
- Request to be added as a member
- Get PAT from team lead or create your own

### 2. Check Azure DevOps Organization

Ask your team:
- "Do we have a MemberJunction Azure DevOps organization?"
- "Who are the admins?"
- "Where are PATs stored?"

Common org URLs:
- https://dev.azure.com/memberjunction
- https://dev.azure.com/MemberJunction

### 3. Check GitHub Repository Settings

The repo `MemberJunction/VSCode` should document:
- Who has publisher access
- Where PATs are stored
- Publishing process/approvals
- Release schedule

**Add this info to the README or a CONTRIBUTING.md file!**

## Pre-Publication Checklist

Before publishing, verify the following:

### Package.json Requirements

Review [package.json](package.json) and ensure:

- ✅ `"publisher": "memberjunction"` (must match your publisher ID)
- ✅ `"name"` is unique and descriptive
- ✅ `"displayName"` is user-friendly
- ✅ `"description"` clearly explains what the extension does
- ✅ `"version"` follows semantic versioning (e.g., "0.1.0")
- ✅ `"engines.vscode"` specifies minimum VSCode version
- ✅ `"categories"` are appropriate
- ✅ `"keywords"` help users find the extension
- ✅ `"repository"` links to GitHub repo
- ✅ `"bugs"` links to issue tracker
- ✅ `"homepage"` links to documentation
- ✅ `"license"` is specified (currently "MIT")

### Required Files

Ensure these files exist and are complete:

- ✅ **README.md** - This becomes your marketplace listing page
  - Should include:
    - Clear description of features
    - Installation instructions
    - Usage examples with screenshots
    - Configuration options
    - Troubleshooting guide
    - Links to documentation

- ✅ **CHANGELOG.md** - Version history
  - List changes for each version
  - Follow format: `## [Version] - Date`

- ✅ **LICENSE** - License file (MIT license)
  - Create if missing

- ✅ **Icon** - Extension icon
  - Located at: `resources/mj-icon.svg` or `.png`
  - Minimum 128x128 pixels
  - PNG or SVG format
  - Appears in marketplace and VSCode extensions view

### Extension Quality Checks

1. **Build without errors**:
   ```bash
   npm run compile
   ```

2. **Test thoroughly**:
   - Press F5 to launch Extension Development Host
   - Test all features (Phase 1 & Phase 2)
   - Verify no console errors
   - Test in different workspace scenarios

3. **Review marketplace presence**:
   - Ensure README.md looks good (it's rendered as Markdown)
   - Add screenshots to README.md showing key features
   - Verify all links work

## Publishing Process

### Step 1: Login to Visual Studio Marketplace

```bash
vsce login memberjunction
```

When prompted, enter the **Personal Access Token** (PAT) for the MemberJunction organization.

**For company publishing**:
- Retrieve the PAT from your company's secure storage (Azure Key Vault, 1Password, etc.)
- Or generate your own PAT from the company Azure DevOps org (see Prerequisites)
- **DO NOT** use a personal PAT from your individual Microsoft account

**Note**: The PAT will be stored locally in `~/.vsce`. If you change machines, you'll need to login again.

**Security**: The PAT file permissions should be restricted:
```bash
chmod 600 ~/.vsce
```

### Step 2: Package the Extension (Optional)

Create a `.vsix` file without publishing:

```bash
vsce package
```

This creates: `memberjunction-vscode-0.1.0.vsix`

You can:
- Test the packaged extension locally
- Share it with beta testers
- Install with: `code --install-extension memberjunction-vscode-0.1.0.vsix`

### Step 3: Publish to Marketplace

```bash
vsce publish
```

This will:
1. Package the extension
2. Upload to the marketplace
3. Make it available publicly

**Alternative**: Publish with version bump:

```bash
vsce publish patch   # 0.1.0 → 0.1.1
vsce publish minor   # 0.1.0 → 0.2.0
vsce publish major   # 0.1.0 → 1.0.0
```

This automatically increments the version in package.json and publishes.

### Step 4: Verify Publication

1. Go to https://marketplace.visualstudio.com/manage
2. Click on your publisher name
3. Verify the extension appears
4. Check the extension page: https://marketplace.visualstudio.com/items?itemName=memberjunction.memberjunction-vscode

**First-time review**: Microsoft reviews new extensions. This can take 1-2 business days.

**Updates**: Subsequent updates are usually published within minutes to a few hours.

## Post-Publication

### Monitor Extension Health

1. **Check installation stats**:
   - View at: https://marketplace.visualstudio.com/manage
   - Track downloads, ratings, reviews

2. **Respond to reviews**:
   - Users can leave reviews/ratings
   - Respond to feedback professionally

3. **Monitor issues**:
   - Watch GitHub issues: https://github.com/MemberJunction/VSCode/issues
   - Fix bugs and release updates

### Publishing Updates

When you have new features or bug fixes:

1. **Update version** in package.json:
   ```json
   {
     "version": "0.2.0"
   }
   ```

2. **Update CHANGELOG.md**:
   ```markdown
   ## [0.2.0] - 2026-01-27
   ### Added
   - Phase 2: CodeGen detection and automation

   ### Fixed
   - Bug in entity explorer
   ```

3. **Commit changes**:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "Bump version to 0.2.0"
   ```

4. **Publish update**:
   ```bash
   vsce publish
   ```

5. **Tag the release** (optional but recommended):
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

## Version Strategy

Follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (1.0.0): Breaking changes
- **MINOR** (0.2.0): New features, backward compatible
- **PATCH** (0.1.1): Bug fixes, backward compatible

### Pre-release Versions

For beta testing:

```bash
vsce publish --pre-release
```

This publishes as a pre-release version that users can opt into.

## Unpublishing

If you need to remove the extension:

```bash
vsce unpublish memberjunction.memberjunction-vscode
```

**WARNING**: This removes the extension completely. Users who have it installed will keep it, but new installations are blocked.

## Common Issues & Solutions

### Issue: "Publisher 'memberjunction' not found"

**Solution**: Create the publisher first at https://marketplace.visualstudio.com/manage

### Issue: "Invalid manifest"

**Solution**:
- Verify package.json is valid JSON
- Check all required fields are present
- Run `vsce package` to validate before publishing

### Issue: "Authentication failed"

**Solution**:
- Verify PAT is still valid (check expiration)
- Ensure PAT has "Marketplace (Manage)" scope
- Try `vsce logout` then `vsce login` again

### Issue: "Extension name already exists"

**Solution**:
- The name must be globally unique
- Try: `memberjunction-tools`, `mj-vscode`, etc.
- Check availability: https://marketplace.visualstudio.com/search?term=memberjunction

### Issue: "Cannot find icon file"

**Solution**:
- Verify path in package.json `"icon"` field
- Ensure file exists and is PNG or SVG
- Use relative path from repo root

### Issue: "README not rendering properly"

**Solution**:
- Use GitHub-flavored Markdown
- Test locally with a Markdown preview
- Avoid HTML (limited support)
- Use relative paths for images

## Best Practices

### 1. README Guidelines

Your README is your storefront:

- **Start with a clear description** and value proposition
- **Add screenshots/GIFs** showing key features
- **Include installation instructions**
- **Document all commands** and settings
- **Provide examples** of common use cases
- **Link to external docs** for more details
- **Keep it updated** with each release

### 2. Extension Quality

- **Test on multiple platforms** (Windows, macOS, Linux)
- **Test with different VSCode versions** (check minimum version)
- **Handle errors gracefully** with user-friendly messages
- **Provide clear output logs** for debugging
- **Follow VSCode extension guidelines**: https://code.visualstudio.com/api/references/extension-guidelines

### 3. User Experience

- **Use status bar wisely** - don't clutter it
- **Provide keyboard shortcuts** for common actions
- **Show progress indicators** for long operations
- **Use notifications appropriately** - not too many
- **Make settings discoverable** - good descriptions

### 4. Security

- **Never include secrets** in published code
- **Validate all user inputs**
- **Use HTTPS** for all network requests
- **Handle credentials securely** (use VSCode's SecretStorage)
- **Review dependencies** for vulnerabilities

### 5. Documentation

- **Maintain a changelog** - users want to know what changed
- **Version documentation** - update README with each release
- **Link to detailed docs** - don't put everything in README
- **Provide troubleshooting guides** - reduce support burden

## Marketing Your Extension

### 1. GitHub Release Notes

Create GitHub releases with detailed notes:
- Tag each version
- Describe new features
- Include screenshots/demos
- Link to marketplace

### 2. Social Media

Announce releases on:
- Twitter/X with #VSCode hashtag
- LinkedIn
- Reddit (r/vscode)
- MemberJunction community channels

### 3. Blog Posts

Write about:
- How to use the extension
- Development process
- Features and benefits
- Integration with MemberJunction workflow

### 4. Demo Videos

Create short videos showing:
- Installation process
- Key features in action
- Common workflows
- Tips and tricks

## Support & Maintenance

### Responding to Issues

- **Acknowledge quickly** - users appreciate responsiveness
- **Ask for details** - VSCode version, OS, logs
- **Reproduce locally** - verify issues before fixing
- **Fix in timely manner** - critical bugs should be addressed ASAP
- **Communicate status** - let users know you're working on it

### Release Cadence

Recommended schedule:
- **Critical bugs**: Patch release within days
- **Minor bugs/improvements**: Minor release monthly
- **Major features**: Major release quarterly

### Deprecation Policy

When removing features:
- **Announce in advance** - give users time to adapt
- **Provide migration path** - how to move to new approach
- **Keep old version available** - don't force immediate upgrade
- **Document changes** - clear changelog entries

## Company Setup Checklist (First Time)

If MemberJunction has never published a VSCode extension before:

### Phase 1: Organizational Setup
- [ ] Verify or create Azure DevOps organization for MemberJunction
- [ ] Add team members who need publishing access
- [ ] Create or verify publisher account on VS Marketplace
- [ ] Add company logo to publisher profile
- [ ] Set up secure storage for PATs (Azure Key Vault or company password manager)
- [ ] Document the process in team wiki/docs

### Phase 2: Access & Permissions
- [ ] Identify 2-3 people who will have publisher access
- [ ] Grant necessary Azure DevOps permissions
- [ ] Generate PATs for each person (or shared PAT stored securely)
- [ ] Test login with `vsce login memberjunction`
- [ ] Document who has access and token expiration dates

### Phase 3: Governance
- [ ] Define release approval process (who approves publications?)
- [ ] Set up release schedule (monthly? on-demand?)
- [ ] Create CONTRIBUTING.md with publishing guidelines
- [ ] Set up token rotation calendar (90-day reminders)
- [ ] Plan for continuity (what if maintainer leaves?)

## Checklist for First Publication

Use this checklist before your first publish:

- [ ] Azure DevOps account created
- [ ] Marketplace publisher created (ID: memberjunction)
- [ ] Personal Access Token generated and stored securely
- [ ] `@vscode/vsce` installed globally
- [ ] package.json has all required fields
- [ ] README.md is complete with screenshots
- [ ] CHANGELOG.md exists
- [ ] LICENSE file exists
- [ ] Extension icon added (128x128 minimum)
- [ ] Extension builds without errors (`npm run compile`)
- [ ] Extension tested thoroughly (F5 testing)
- [ ] All features working as expected
- [ ] No console errors or warnings
- [ ] Logged in to marketplace (`vsce login`)
- [ ] Ready to run `vsce publish`

## Quick Reference Commands

```bash
# Install publishing tool
npm install -g @vscode/vsce

# Login
vsce login memberjunction

# Package without publishing (testing)
vsce package

# Publish
vsce publish

# Publish with version bump
vsce publish patch   # Bug fixes
vsce publish minor   # New features
vsce publish major   # Breaking changes

# Publish pre-release
vsce publish --pre-release

# Unpublish (use with caution!)
vsce unpublish memberjunction.memberjunction-vscode

# Show extension info
vsce show memberjunction.memberjunction-vscode

# Logout
vsce logout
```

## Resources

- **VSCode Publishing Guide**: https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- **Extension Guidelines**: https://code.visualstudio.com/api/references/extension-guidelines
- **Extension Manifest**: https://code.visualstudio.com/api/references/extension-manifest
- **Marketplace Management**: https://marketplace.visualstudio.com/manage
- **Azure DevOps**: https://dev.azure.com
- **VSCE Documentation**: https://github.com/microsoft/vscode-vsce

## Getting Access to Existing Company Publisher

If MemberJunction already has a publisher account and you need access:

### Step 1: Find the Current Owner

1. Visit the marketplace page (if extension exists)
2. Look for "More Info" → Publisher link
3. Check publisher profile for contact information
4. Or ask in your company Slack/Teams: "Who manages our VSCode marketplace publisher?"

### Step 2: Request Access

Email or message the publisher owner/admin:

```
Subject: Request Access to MemberJunction VSCode Publisher

Hi [Owner Name],

I'm working on the MemberJunction VSCode extension and need publishing
access to update it.

Could you please:
1. Add me as a member of the "memberjunction" publisher account
2. Grant me permissions to publish extensions
3. Share the process for getting a PAT (or add me to Azure DevOps org)

My details:
- Name: [Your Name]
- Email: [Your Work Email]
- Microsoft Account: [Your Account]
- Role: [Developer/Maintainer/etc.]

Thanks!
```

### Step 3: After Getting Access

Once added:
1. Generate your own PAT from the Azure DevOps organization
2. Test with: `vsce login memberjunction`
3. Verify with: `vsce show memberjunction.memberjunction-vscode`
4. Document yourself in the maintainers list

## Getting Help

If you encounter issues:

1. **Check VSCE issues**: https://github.com/microsoft/vscode-vsce/issues
2. **VSCode Extension Docs**: https://code.visualstudio.com/api
3. **Stack Overflow**: Tag questions with `vscode-extensions`
4. **VSCode Discord**: https://aka.ms/vscode-discord
5. **Company Team**: Ask your DevOps/Platform team for Azure help

---

**Ready to publish?** Follow the steps above and your extension will be live on the VSCode Marketplace!

Good luck! 🚀
