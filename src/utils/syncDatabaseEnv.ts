/**
 * Syncs critical database environment variables into `process.env` so
 * that child processes spawned by the installer engine (e.g. `npx mj migrate`)
 * see the correct connection settings.
 *
 * The MJ installer's ConfigurePhase writes `.env` files, but not all
 * critical settings may be present in every file. The `mj` CLI loads
 * only the root `.env` via `dotenv.config()`, and dotenv does NOT
 * override variables that are already set in the environment.
 *
 * This utility reads both the root `.env` and `packages/MJAPI/.env`,
 * merges them (MJAPI values win on conflict), and injects any missing
 * critical variables into `process.env`. It also applies sensible
 * defaults for settings that are commonly omitted but required for
 * local development (e.g. `DB_TRUST_SERVER_CERTIFICATE`).
 *
 * Uses synchronous `fs` APIs so the work completes before the installer
 * engine advances to the next phase.
 *
 * @module utils/syncDatabaseEnv
 */
import * as fs from 'fs';
import * as path from 'path';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Database-related environment variables that are critical for child
 * processes (e.g. `npx mj migrate`) and may be absent from the root `.env`.
 */
const CRITICAL_DB_VARS = [
    'DB_TRUST_SERVER_CERTIFICATE',
    'DB_HOST',
    'DB_PORT',
    'DB_DATABASE',
    'DB_USERNAME',
    'DB_PASSWORD',
    'CODEGEN_DB_USERNAME',
    'CODEGEN_DB_PASSWORD',
    'GRAPHQL_PORT',
];

/**
 * Sensible defaults for variables that are commonly missing from `.env`
 * files but required for local development. These are only applied when
 * the variable is absent from both `.env` files AND `process.env`.
 *
 * - `DB_TRUST_SERVER_CERTIFICATE`: Local SQL Server installations use
 *   self-signed certificates by default. Without this, `tedious` (the
 *   mssql driver) rejects the connection with "self-signed certificate".
 */
const DEFAULTS: Record<string, string> = {
    DB_TRUST_SERVER_CERTIFICATE: 'true',
};

/**
 * Read both the root `.env` and `packages/MJAPI/.env`, merge their values,
 * and inject any critical database variables that are missing from
 * `process.env`. Variables already present in the environment are left
 * untouched. MJAPI values take precedence over root values on conflict.
 *
 * @param installDir - Absolute path to the MJ install root directory.
 * @returns Number of variables injected into `process.env`.
 */
export function syncDatabaseEnv(installDir: string): number {
    const rootEnvPath = path.join(installDir, '.env');
    const mjapiEnvPath = path.join(installDir, 'packages', 'MJAPI', '.env');

    // Merge both files — MJAPI values override root values on conflict
    const merged = new Map<string, string>();
    mergeEnvFile(rootEnvPath, merged);
    mergeEnvFile(mjapiEnvPath, merged);

    let injected = 0;

    for (const key of CRITICAL_DB_VARS) {
        if (process.env[key]) {
            continue; // Already set — don't override
        }

        const fileValue = merged.get(key);
        const defaultValue = DEFAULTS[key];
        const value = fileValue ?? defaultValue;

        if (value != null) {
            process.env[key] = value;
            injected++;
        }
    }

    if (injected > 0) {
        OutputChannel.info(`Propagated ${injected} database setting(s) to child process environment.`);
    }

    return injected;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse an `.env` file and merge its key-value pairs into {@link target}.
 * Later calls overwrite earlier values for the same key.
 *
 * @param envPath - Absolute path to the `.env` file.
 * @param target - Map to merge parsed values into.
 */
function mergeEnvFile(envPath: string, target: Map<string, string>): void {
    let content: string;
    try {
        content = fs.readFileSync(envPath, 'utf-8');
    } catch {
        return; // File doesn't exist or isn't readable
    }

    for (const [key, value] of parseEnvFile(content)) {
        target.set(key, value);
    }
}

/**
 * Minimal `.env` file parser.
 *
 * Handles `KEY=VALUE`, `KEY='VALUE'`, and `KEY="VALUE"` forms.
 * Comments (`#`) and blank lines are skipped.
 *
 * @param content - Raw `.env` file content.
 * @returns Map of key-value pairs parsed from the file.
 */
function parseEnvFile(content: string): Map<string, string> {
    const result = new Map<string, string>();

    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const eqIdx = trimmed.indexOf('=');
        if (eqIdx < 1) {
            continue;
        }

        const key = trimmed.slice(0, eqIdx).trim();
        let value = trimmed.slice(eqIdx + 1).trim();

        // Strip surrounding quotes
        if ((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"'))) {
            value = value.slice(1, -1);
        }

        result.set(key, value);
    }

    return result;
}
