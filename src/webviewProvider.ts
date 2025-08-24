import * as vscode from 'vscode';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

interface PlanStep {
    id: string;
    content: string;
    status?: 'accepted' | 'rejected' | 'edited' | 'refining';
    originalIndex: number;
}

interface PlanState {
    steps: PlanStep[];
    taskDescription: string;
    lastModified: Date;
}

// Custom VS Code API interface for the webview
interface VsCodeApi extends EventTarget {
    postMessage(message: any): void;
    setState(state: any): void;
    getState(): any;
}

declare function acquireVsCodeApi(): VsCodeApi;

// Helper to get webview URI for a given file
function getWebviewUri(webview: vscode.Webview, extensionUri: vscode.Uri, relativePath: string): vscode.Uri {
    return webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'src', relativePath));
}

export function generateNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

// Helper function to clean markdown formatting and convert to HTML for webview display
function cleanMarkdown(text: string): string {
    return text
        // Convert **bold** to <strong>
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        // Convert *italic* to <em>
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        // Convert `code` to <code>
        .replace(/`(.*?)`/g, '<code>$1</code>')
        // Convert - bullets to actual bullets
        .replace(/^- (.*$)/gim, '• $1')
        // Clean up any remaining markdown artifacts
        .replace(/#{1,6}\s/g, '')
        // Ensure proper line breaks
        .replace(/\n/g, '<br>');
}

// Updated step card creation with better HTML rendering
function createEditableStepCard(step: PlanStep): string {
    const cleanedContent = cleanMarkdown(step.content);
    let statusClass = '';
    let statusIcon = '';
    
    if (step.status === 'accepted') {
        statusClass = 'accepted';
        statusIcon = '<div class="status-icon accepted-icon">✓</div>';
    } else if (step.status === 'rejected') {
        statusClass = 'rejected';
        statusIcon = '<div class="status-icon rejected-icon">↻</div>';
    } else if (step.status === 'edited') {
        statusClass = 'edited';
        statusIcon = '<div class="status-icon edited-icon">✎</div>';
    } else if (step.status === 'refining') {
        statusClass = 'refining';
        statusIcon = '<div class="status-icon rejected-icon">↻</div>'; // Use rejected-icon for refining animation
    }

    // The `data-original-content` will be set by JS on edit mode entry
    return `
        <div class="step-card ${statusClass}" data-id="${step.id}" draggable="true">
            <div class="step-header">
                <span class="step-number">Step ${step.originalIndex}</span>
                ${statusIcon}
                <div class="step-controls">
                    <button class="edit-button" title="Edit Step">✎ Edit</button>
                    <button class="save-edit-button" style="display:none;" title="Save Changes">Save</button>
                    <button class="cancel-edit-button" style="display:none;" title="Cancel Edit">Cancel</button>
                    <button class="delete-button" title="Delete Step">🗑️ Delete</button>
                    <button class="reorder-up-button" title="Move Up">⬆️</button>
                    <button class="reorder-down-button" title="Move Down">⬇️</button>
                    <button class="accept-button" ${step.status === 'accepted' ? 'disabled' : ''}>${step.status === 'accepted' ? '✓ Accepted' : '✓ Accept'}</button>
                    <button class="reject-button" ${step.status === 'rejected' || step.status === 'refining' ? 'disabled' : ''}>${step.status === 'refining' ? '↻ Generating...' : '↻ Alternative'}</button>
                </div>
            </div>
            <div class="step-content contenteditable-content" contenteditable="false">${cleanedContent}</div>
        </div>
    `;
}

export function getAdvancedWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri, planState: PlanState, nonce: string): string {
    const htmlPath = path.join(extensionUri.fsPath, 'src', 'webview.html');
    const cssPath = path.join(extensionUri.fsPath, 'src', 'webview.css');
    const jsPath = path.join(extensionUri.fsPath, 'src', 'webview.js');

    let htmlContent = fs.readFileSync(htmlPath, 'utf8');
    const cssUri = getWebviewUri(webview, extensionUri, 'webview.css');
    const jsUri = getWebviewUri(webview, extensionUri, 'webview.js');

    const stepCardsHtml = planState.steps.map(step => createEditableStepCard(step)).join('');
    const taskDescription = planState.taskDescription;

    htmlContent = htmlContent.replace(/{{cssUri}}/g, cssUri.toString());
    htmlContent = htmlContent.replace(/{{jsUri}}/g, jsUri.toString());
    htmlContent = htmlContent.replace(/{{nonce}}/g, nonce);
    htmlContent = htmlContent.replace(/{{stepCardsHtml}}/g, stepCardsHtml);
    htmlContent = htmlContent.replace(/{{taskDescription}}/g, taskDescription);
    // Inject window.planState, cleanMarkdown, and createEditableStepCard directly
    const scriptToInject = `
        <script nonce="${nonce}">
            window.planState = ${JSON.stringify(planState)};
            window.cleanMarkdown = ${cleanMarkdown.toString()};
            window.createEditableStepCard = ${createEditableStepCard.toString()};
        </script>
    `;
    htmlContent = htmlContent.replace('</body>', `${scriptToInject}</body>`);

    return htmlContent;
}
