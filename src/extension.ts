import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Feature } from './types';
import { MetadataSyncFeature } from './features/metadata-sync/MetadataSyncFeature';
import { EntityExplorerFeature } from './features/entity-explorer/EntityExplorerFeature';
import { CodeGenFeature } from './features/codegen/CodeGenFeature';
import { AIAssistanceFeature } from './features/ai-assistance/AIAssistanceFeature';
import { TestExplorerFeature } from './features/test-explorer/TestExplorerFeature';
import { OutputChannel } from './common/OutputChannel';
import { StatusBarManager } from './common/StatusBarManager';

// NOTE: @memberjunction/core-actions and AI providers are loaded dynamically in initializeAIComponents()
// This ensures the cache directory is set up before the local embeddings module loads

// Import AI provider loader functions - these register the driver classes
import { LoadLocalEmbedding } from '@memberjunction/ai-local-embeddings';
import { LoadOpenAILLM, LoadOpenAIEmbedding } from '@memberjunction/ai-openai';
import { LoadAnthropicLLM } from '@memberjunction/ai-anthropic';
import { LoadGroqLLM } from '@memberjunction/ai-groq';

/**
 * List of all features to be registered
 */
const features: Feature[] = [
    new MetadataSyncFeature(),
    new EntityExplorerFeature(),
    new CodeGenFeature(),
    new AIAssistanceFeature(),
    new TestExplorerFeature()
];

/**
 * Initialize AI components including providers and actions
 * Must be called before agent execution to register all required classes
 */
async function initializeAIComponents(): Promise<void> {
    // Set up cache directory for transformers/embeddings BEFORE loading modules
    // This prevents ENOENT errors when the local embeddings module tries to create .cache
    const transformersCacheDir = path.join(os.tmpdir(), 'mj-vscode-cache', 'transformers');
    try {
        fs.mkdirSync(transformersCacheDir, { recursive: true });
        process.env.TRANSFORMERS_CACHE_DIR = transformersCacheDir;
        console.log(`[MJ Extension] Set TRANSFORMERS_CACHE_DIR to: ${transformersCacheDir}`);
    } catch (err) {
        console.error(`[MJ Extension] Failed to create cache directory:`, err);
    }

    // Load AI providers - these register driver classes needed for embeddings and LLM calls
    try {
        console.log(`[MJ Extension] Loading AI providers...`);

        // Load LLM providers
        LoadOpenAILLM();
        LoadAnthropicLLM();
        LoadGroqLLM();

        // Load embedding providers - LocalEmbedding is critical for agent discovery
        LoadLocalEmbedding();
        LoadOpenAIEmbedding();

        console.log(`[MJ Extension] AI providers loaded successfully`);
    } catch (err) {
        console.error(`[MJ Extension] Failed to load AI providers:`, err);
    }

    // Now dynamically import core-actions and call LoadAllCoreActions to register action classes
    // This enables actions like "Web Search", "Find Candidate Agents", "Web Page Content"
    // CRITICAL: Must call LoadAllCoreActions() - just importing the module isn't enough due to tree-shaking
    try {
        console.log(`[MJ Extension] Loading core-actions...`);
        const coreActions = await import('@memberjunction/core-actions');
        coreActions.LoadAllCoreActions();
        console.log(`[MJ Extension] core-actions loaded and registered successfully`);
    } catch (err) {
        console.error(`[MJ Extension] Failed to load core-actions:`, err);
    }
}

/**
 * Extension activation entry point
 */
export async function activate(context: vscode.ExtensionContext) {
    OutputChannel.info('MemberJunction extension activating...');

    try {
        // Initialize AI components (providers and actions)
        // This must happen before any agent execution to register all required classes
        await initializeAIComponents();

        // Check if we're in a MemberJunction workspace
        const isWorkspaceValid = await checkWorkspace();

        // Always set context to true so views show up
        vscode.commands.executeCommand('setContext', 'memberjunction.workspaceInitialized', true);

        if (!isWorkspaceValid) {
            OutputChannel.warn('Not a MemberJunction workspace - some features may be limited');
            OutputChannel.warn('The extension works best in a workspace with @memberjunction/core installed');
            // We'll still activate but with limited functionality
        }

        // Activate all enabled features
        for (const feature of features) {
            if (feature.enabled()) {
                try {
                    await feature.activate(context);
                    OutputChannel.info(`✓ ${feature.name} activated`);
                } catch (error) {
                    OutputChannel.error(`✗ ${feature.name} failed to activate`, error as Error);
                    vscode.window.showErrorMessage(
                        `Failed to activate ${feature.name}: ${(error as Error).message}`
                    );
                }
            } else {
                OutputChannel.info(`○ ${feature.name} disabled in settings`);
            }
        }

        // Register configuration change handler
        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('memberjunction')) {
                    OutputChannel.info('Configuration changed, notifying features...');
                    for (const feature of features) {
                        if (feature.onConfigChange) {
                            feature.onConfigChange({});
                        }
                    }
                }
            })
        );

        OutputChannel.info('MemberJunction extension activated successfully');
        vscode.window.showInformationMessage('MemberJunction extension activated');

    } catch (error) {
        OutputChannel.error('Failed to activate MemberJunction extension', error as Error);
        vscode.window.showErrorMessage(
            `Failed to activate MemberJunction extension: ${(error as Error).message}`
        );
    }
}

/**
 * Extension deactivation
 */
export async function deactivate() {
    OutputChannel.info('MemberJunction extension deactivating...');

    // Deactivate all features
    for (const feature of features) {
        try {
            await feature.deactivate();
            OutputChannel.info(`✓ ${feature.name} deactivated`);
        } catch (error) {
            OutputChannel.error(`✗ Failed to deactivate ${feature.name}`, error as Error);
        }
    }

    // Clean up shared resources
    StatusBarManager.dispose();
    OutputChannel.dispose();

    OutputChannel.info('MemberJunction extension deactivated');
}

/**
 * Check if the current workspace is a valid MemberJunction workspace
 */
async function checkWorkspace(): Promise<boolean> {
    const workspaceFolders = vscode.workspace.workspaceFolders;

    if (!workspaceFolders || workspaceFolders.length === 0) {
        return false;
    }

    // Look for indicators of a MemberJunction workspace:
    // 1. mj.config.js or mj.config.cjs
    // 2. packages/GeneratedEntities directory
    // 3. node_modules/@memberjunction

    const patterns = [
        '**/mj.config.{js,cjs,json}',
        '**/packages/GeneratedEntities',
        '**/node_modules/@memberjunction/core'
    ];

    for (const pattern of patterns) {
        const files = await vscode.workspace.findFiles(pattern, '**/node_modules/**', 1);
        if (files.length > 0) {
            OutputChannel.info(`Found MemberJunction workspace indicator: ${pattern}`);
            return true;
        }
    }

    return false;
}
