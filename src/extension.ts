import * as vscode from 'vscode';
import { Feature } from './types';
import { MetadataSyncFeature } from './features/metadata-sync/MetadataSyncFeature';
import { EntityExplorerFeature } from './features/entity-explorer/EntityExplorerFeature';
import { OutputChannel } from './common/OutputChannel';
import { StatusBarManager } from './common/StatusBarManager';

/**
 * List of all features to be registered
 */
const features: Feature[] = [
    new MetadataSyncFeature(),
    new EntityExplorerFeature()
];

/**
 * Extension activation entry point
 */
export async function activate(context: vscode.ExtensionContext) {
    OutputChannel.info('MemberJunction extension activating...');

    try {
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
