import * as crypto from 'crypto';

export function generateNonce(): string {
    return crypto.randomBytes(16).toString('base64');
}

export function generateStepId(): string {
    return crypto.randomUUID();
}

export function cleanMarkdown(text: string): string {
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
