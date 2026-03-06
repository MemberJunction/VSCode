/**
 * Supplementary single-quote patcher for Windows.
 *
 * On Windows `cmd.exe`, single quotes are NOT quote characters — they're
 * passed literally to commands. This breaks npm scripts like:
 *
 *     "copy-assets": "cpy 'src/lib/_tokens.scss' dist/lib --flat"
 *
 * The MJInstaller's PlatformCompatPhase handles this, but under certain
 * conditions (Turbo cache, file-system timing) it may miss some files.
 * This utility runs as a safety net after the platform phase completes,
 * catching any remaining single-quoted path/glob arguments.
 *
 * Uses synchronous `fs` APIs so the work completes before the installer
 * engine advances to the next phase.
 */
import * as fs from 'fs';
import * as path from 'path';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Matches single-quoted arguments containing `/` or `*` (file paths and globs).
 * Example matches: `'src/lib/styles/**'`, `'src/lib/_tokens.scss'`
 */
const SINGLE_QUOTED_ARG = /'([^']*[/*][^']*)'/g;

/**
 * Matches `node -e "..."` and `node -p "..."` inline code blocks.
 * Single quotes inside these are JS string delimiters, not shell quotes.
 */
const NODE_EVAL_BLOCK = /node\s+-[ep]\s+"[^"]*"/g;

/**
 * Result of the supplementary single-quote patching pass.
 */
interface PatchResult {
    /** Total `package.json` files scanned. */
    Scanned: number;
    /** Number of files that had scripts patched. */
    Patched: number;
    /** Relative paths of patched files (e.g. `packages/Angular/Generic/shared`). */
    PatchedFiles: string[];
}

/**
 * Scan all `package.json` files under `dir` (up to `maxDepth`) and replace
 * single-quoted path/glob arguments with double-quoted equivalents.
 *
 * Only operates on Windows (`process.platform === 'win32'`). Returns
 * immediately on other platforms.
 */
export function patchSingleQuotedScripts(dir: string, maxDepth: number = 5): PatchResult {
    const result: PatchResult = { Scanned: 0, Patched: 0, PatchedFiles: [] };

    if (process.platform !== 'win32') {
        return result;
    }

    const packageJsonFiles: string[] = [];
    collectPackageJsonFiles(dir, maxDepth, 0, packageJsonFiles);

    result.Scanned = packageJsonFiles.length;

    for (const pkgPath of packageJsonFiles) {
        if (patchFile(pkgPath)) {
            result.Patched++;
            result.PatchedFiles.push(path.relative(dir, pkgPath));
        }
    }

    if (result.Patched > 0) {
        OutputChannel.info(
            `Patched ${result.Patched} additional package.json file(s) for single-quote compatibility: ${result.PatchedFiles.join(', ')}`
        );
    }

    return result;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect `package.json` paths under {@link dir}, skipping
 * `node_modules`, `.git`, and `dist` directories.
 *
 * @param dir - Directory to scan.
 * @param maxDepth - Maximum recursion depth relative to the root.
 * @param currentDepth - Current recursion depth (callers pass `0`).
 * @param out - Accumulator array that paths are appended to.
 */
function collectPackageJsonFiles(
    dir: string,
    maxDepth: number,
    currentDepth: number,
    out: string[]
): void {
    if (currentDepth > maxDepth) {
        return;
    }

    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return; // permission error, symlink loop, etc.
    }

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') {
                continue;
            }
            collectPackageJsonFiles(fullPath, maxDepth, currentDepth + 1, out);
        } else if (entry.name === 'package.json') {
            out.push(fullPath);
        }
    }
}

/**
 * Check and patch a single `package.json` file. Replaces single-quoted
 * path/glob arguments in npm scripts with double-quoted equivalents.
 *
 * @param pkgPath - Absolute path to the `package.json` file.
 * @returns `true` if the file was modified on disk.
 */
function patchFile(pkgPath: string): boolean {
    let content: string;
    try {
        content = fs.readFileSync(pkgPath, 'utf-8');
    } catch {
        return false;
    }

    let pkg: { scripts?: Record<string, string> };
    try {
        pkg = JSON.parse(content);
    } catch {
        return false;
    }

    if (!pkg.scripts) {
        return false;
    }

    let changed = false;
    for (const [name, script] of Object.entries(pkg.scripts)) {
        // Strip node -e/node -p blocks before testing for single quotes
        const stripped = script.replace(NODE_EVAL_BLOCK, '');
        if (!SINGLE_QUOTED_ARG.test(stripped)) {
            // Reset regex lastIndex (global flag)
            SINGLE_QUOTED_ARG.lastIndex = 0;
            continue;
        }
        SINGLE_QUOTED_ARG.lastIndex = 0;

        // Replace single quotes outside of node -e blocks
        const patched = replaceSingleQuotesPreservingNodeCode(script);
        if (patched !== script) {
            pkg.scripts[name] = patched;
            changed = true;
        }
    }

    if (changed) {
        try {
            fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            OutputChannel.warn(`[platformPatch] Could not write ${pkgPath}: ${msg}`);
            return false;
        }
    }

    return changed;
}

/**
 * Replace single-quoted path/glob arguments with double-quoted equivalents,
 * preserving any `node -e "..."` / `node -p "..."` blocks verbatim.
 *
 * The function splits the script around embedded Node eval blocks, applies
 * the quote replacement only to the non-Node segments, then reassembles.
 *
 * @param script - The raw npm script string to transform.
 * @returns The transformed script with single quotes replaced.
 */
function replaceSingleQuotesPreservingNodeCode(script: string): string {
    const parts: string[] = [];
    let lastIndex = 0;

    for (const match of script.matchAll(NODE_EVAL_BLOCK)) {
        // Transform the gap before this node -e block
        parts.push(script.slice(lastIndex, match.index).replace(SINGLE_QUOTED_ARG, '"$1"'));
        // Keep the node -e block untouched
        parts.push(match[0]);
        lastIndex = match.index + match[0].length;
    }

    // Transform the remainder after the last node -e block (or the whole string)
    parts.push(script.slice(lastIndex).replace(SINGLE_QUOTED_ARG, '"$1"'));
    return parts.join('');
}
