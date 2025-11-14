import * as vscode from 'vscode';
import { EntityDiscovery } from '../services/EntityDiscovery';
import { MetadataRootDiscovery } from '../services/MetadataRootDiscovery';
import { OutputChannel } from '../common/OutputChannel';

/**
 * Provides hover information for entity fields and metadata keywords
 */
export class MJSyncHoverProvider implements vscode.HoverProvider {
    private entityDiscovery: EntityDiscovery;
    private rootDiscovery: MetadataRootDiscovery;

    constructor() {
        this.entityDiscovery = EntityDiscovery.getInstance();
        this.rootDiscovery = MetadataRootDiscovery.getInstance();
    }

    async provideHover(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.Hover | undefined> {
        try {
            const wordRange = document.getWordRangeAtPosition(position, /"[^"]*"/);
            if (!wordRange) {
                return undefined;
            }

            const word = document.getText(wordRange).replace(/"/g, '');

            // Check if hovering over entity name
            const entity = this.entityDiscovery.getEntity(word);
            if (entity) {
                return this.createEntityHover(entity);
            }

            // Check if hovering over a metadata keyword
            if (word.startsWith('@')) {
                return this.createMetadataKeywordHover(word);
            }

            // Check if hovering over a field name in entity record file
            const entityName = await this.rootDiscovery.getEntityNameForFile(document.fileName);
            if (entityName) {
                const entityInfo = this.entityDiscovery.getEntity(entityName);
                if (entityInfo) {
                    const field = entityInfo.fields.find(f => f.name === word);
                    if (field) {
                        return this.createFieldHover(field, entityInfo.name);
                    }
                }
            }

            return undefined;
        } catch (error) {
            OutputChannel.error('Error providing hover', error as Error);
            return undefined;
        }
    }

    private createEntityHover(entity: any): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`### ${entity.name}\n\n`);
        markdown.appendMarkdown(`*${entity.isCore ? 'Core' : 'Custom'} Entity*\n\n`);
        markdown.appendMarkdown(`**Table:** \`${entity.schemaName}.${entity.baseTable}\`\n\n`);
        markdown.appendMarkdown(`**View:** \`${entity.baseView}\`\n\n`);
        markdown.appendMarkdown(`**Fields:** ${entity.fields.length}\n\n`);

        if (entity.description) {
            markdown.appendMarkdown(`---\n\n${entity.description}\n\n`);
        }

        // Show sample fields
        const sampleFields = entity.fields.slice(0, 5);
        if (sampleFields.length > 0) {
            markdown.appendMarkdown(`**Sample Fields:**\n\n`);
            for (const field of sampleFields) {
                markdown.appendMarkdown(`- \`${field.name}\`: ${field.type}\n`);
            }
            if (entity.fields.length > 5) {
                markdown.appendMarkdown(`- *...and ${entity.fields.length - 5} more*\n`);
            }
        }

        return new vscode.Hover(markdown);
    }

    private createFieldHover(field: any, entityName: string): vscode.Hover {
        const markdown = new vscode.MarkdownString();
        markdown.appendMarkdown(`### ${field.displayName || field.name}\n\n`);
        markdown.appendMarkdown(`*Field in ${entityName}*\n\n`);
        markdown.appendMarkdown(`**Type:** \`${field.type}${field.length ? `(${field.length})` : ''}\`\n\n`);
        markdown.appendMarkdown(`**Nullable:** ${field.allowsNull ? 'Yes' : 'No'}\n\n`);

        if (field.isPrimaryKey) {
            markdown.appendMarkdown(`🔑 **Primary Key**\n\n`);
        }

        if (field.isUnique) {
            markdown.appendMarkdown(`⭐ **Unique**\n\n`);
        }

        if (field.relatedEntity) {
            markdown.appendMarkdown(`**Related Entity:** \`${field.relatedEntity}\`\n\n`);
        }

        if (field.description) {
            markdown.appendMarkdown(`---\n\n${field.description}\n\n`);
        }

        // Show metadata keyword options
        markdown.appendMarkdown(`---\n\n**Metadata Keywords:**\n\n`);
        markdown.appendMarkdown(`- \`@lookup:EntityName.FieldName\` - Reference another entity\n`);
        markdown.appendMarkdown(`- \`@file:path/to/file.ext\` - Load content from external file\n`);
        markdown.appendMarkdown(`- \`@parent:FieldName\` - Reference parent entity field\n`);
        markdown.appendMarkdown(`- \`@env:VARIABLE_NAME\` - Use environment variable\n`);

        return new vscode.Hover(markdown);
    }

    private createMetadataKeywordHover(keyword: string): vscode.Hover {
        const markdown = new vscode.MarkdownString();

        if (keyword.startsWith('@lookup:')) {
            markdown.appendMarkdown(`### @lookup: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Performs a lookup to find an entity by a field value and uses its ID.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@lookup:EntityName.FieldName=Value\`\n\n`);
            markdown.appendMarkdown(`**Example:** \`@lookup:AI Prompt Types.Name=Chat\`\n\n`);
            markdown.appendMarkdown(`**With Create:** \`@lookup:EntityName.FieldName=Value?create&Field2=Value2\`\n\n`);
        } else if (keyword.startsWith('@file:')) {
            markdown.appendMarkdown(`### @file: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Loads content from an external file.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@file:relative/path/to/file.ext\`\n\n`);
            markdown.appendMarkdown(`**Example:** \`@file:templates/my-template.md\`\n\n`);
            markdown.appendMarkdown(`Path is relative to the .mj-sync.json file.\n\n`);
        } else if (keyword.startsWith('@parent:')) {
            markdown.appendMarkdown(`### @parent: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`References a field from the parent entity record.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@parent:FieldName\`\n\n`);
            markdown.appendMarkdown(`**Example:** \`@parent:ID\`\n\n`);
            markdown.appendMarkdown(`Only valid in \`relatedEntities\` sections.\n\n`);
        } else if (keyword.startsWith('@root:')) {
            markdown.appendMarkdown(`### @root: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`References a field from the root entity record.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@root:FieldName\`\n\n`);
            markdown.appendMarkdown(`**Example:** \`@root:Name\`\n\n`);
        } else if (keyword.startsWith('@env:')) {
            markdown.appendMarkdown(`### @env: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Gets value from an environment variable.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@env:VARIABLE_NAME\`\n\n`);
            markdown.appendMarkdown(`**Example:** \`@env:DATABASE_URL\`\n\n`);
        } else if (keyword.startsWith('@url:')) {
            markdown.appendMarkdown(`### @url: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Fetches content from a remote URL.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@url:https://example.com/data\`\n\n`);
        } else if (keyword.startsWith('@template:')) {
            markdown.appendMarkdown(`### @template: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Loads and merges a JSON template.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@template:path/to/template.json\`\n\n`);
        } else if (keyword.startsWith('@include:')) {
            markdown.appendMarkdown(`### @include: Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Merges an external JSON file into the current structure.\n\n`);
            markdown.appendMarkdown(`**Syntax:** \`@include:path/to/file.json\`\n\n`);
        } else {
            markdown.appendMarkdown(`### Metadata Keyword\n\n`);
            markdown.appendMarkdown(`Metadata keywords start with @ and provide special functionality:\n\n`);
            markdown.appendMarkdown(`- \`@lookup:\` - Entity lookup by field value\n`);
            markdown.appendMarkdown(`- \`@file:\` - Load external file content\n`);
            markdown.appendMarkdown(`- \`@parent:\` - Reference parent entity field\n`);
            markdown.appendMarkdown(`- \`@root:\` - Reference root entity field\n`);
            markdown.appendMarkdown(`- \`@env:\` - Environment variable\n`);
            markdown.appendMarkdown(`- \`@url:\` - Fetch remote URL\n`);
            markdown.appendMarkdown(`- \`@template:\` - Load JSON template\n`);
            markdown.appendMarkdown(`- \`@include:\` - Merge external JSON\n`);
        }

        return new vscode.Hover(markdown);
    }
}
