import * as vscode from 'vscode';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
// import { cleanMarkdown } from './webviewProvider';

export async function getOpenAiApiKey(): Promise<string | undefined> {
    const envApiKey = process.env.OPENAI_API_KEY;
    if (envApiKey) {
        return envApiKey;
    }
    const config = vscode.workspace.getConfiguration('traycer-mini');
    return config.get('openaiApiKey');
}

export async function getProjectContext(): Promise<string> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return "No workspace folder detected.";
    }

    let context = `Project: ${workspaceFolder.name}\n`;
    
    // Try to read package.json for project info
    try {
        const packagePath = path.join(workspaceFolder.uri.fsPath, 'package.json');
        if (fs.existsSync(packagePath)) {
            const packageContent = fs.readFileSync(packagePath, 'utf8');
            const packageJson = JSON.parse(packageContent);
            context += `Framework: ${packageJson.dependencies ? Object.keys(packageJson.dependencies).slice(0, 5).join(', ') : 'Unknown'}\n`;
            context += `Description: ${packageJson.description || 'No description'}\n`;
        }
    } catch (error) {
        // Ignore package.json reading errors
    }

    // Get file structure overview
    try {
        const files = await vscode.workspace.findFiles('**/*.{js,ts,jsx,tsx,py,java,cs,cpp,c,go,rs}', '**/node_modules/**', 20);
        if (files.length > 0) {
            context += `Main files: ${files.map(f => path.basename(f.fsPath)).join(', ')}\n`;
        }
    } catch (error) {
        // Ignore file search errors
    }

    return context;
}

export function parsePlanIntoSteps(plan: string): string[] {
    const steps: string[] = [];
    
    // Split by "Step X:" pattern (case insensitive)
    const stepSections = plan.split(/(?=Step\s+\d+:)/i);
    
    for (const section of stepSections) {
        const trimmedSection = section.trim();
        if (trimmedSection.length === 0) continue;
        
        // Extract the step content after "Step X:"
        const stepMatch = trimmedSection.match(/^Step\s+\d+:\s*(.*)/is);
        if (stepMatch && stepMatch[1]) {
            const stepContent = stepMatch[1].trim();
            if (stepContent.length > 20) { // Ensure it's not empty or too short
                steps.push(stepContent);
            }
        }
    }
    
    return steps; // Return all steps - we control the count in the prompt
}
    
    // Helper function to clean markdown formatting and convert to HTML
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

export function getStrictFormattedPrompt(task: string, projectContext: string): string {
    return `You are an expert software engineer creating a detailed, file-level implementation plan.

PROJECT CONTEXT:
${projectContext}

IMPLEMENTATION TASK:
"${task}"

CRITICAL FORMATTING REQUIREMENT:
You MUST use EXACTLY this format: "Step 1:", "Step 2:", "Step 3:", etc.
Generate EXACTLY 8-12 steps total.
NO other numbering formats allowed (no bullets, no "1.", no "## Step 1").

IMPLEMENTATION DEPTH REQUIRED:
For each step, specify:
✓ Exact file paths and names
✓ Specific functions/methods to create or modify  
✓ Required imports and dependencies
✓ Configuration changes needed
✓ Database schema updates if applicable
✓ API endpoints and their methods
✓ Frontend component modifications
✓ Testing requirements

STEP SEQUENCING LOGIC:
1. Setup and dependencies first (installations, configurations)
2. Backend/API changes (models, services, endpoints)
3. Frontend updates (components, hooks, state management)
4. Integration and testing
5. Documentation and cleanup

QUALITY CRITERIA:
- Each step should take 15-45 minutes to implement
- Include command-line instructions where needed
- Mention specific variable names and function signatures
- Reference actual framework patterns (React hooks, Express middleware, etc.)
- Consider error handling and edge cases
- Think about performance and security implications

EXAMPLE TECHNICAL DEPTH:
Step 1: Create src/models/User.js with a Mongoose schema including fields: email (unique, required), passwordHash (required), createdAt (default Date.now), and isActive (default true). Add validation for email format using validator library and export the model as 'User'.

Step 2: Install authentication dependencies with npm install bcryptjs jsonwebtoken express-validator and update package.json. Create .env variables JWT_SECRET and JWT_EXPIRES_IN, then restart your development server to load new environment variables.

Now create your technical implementation plan using the exact "Step X:" format:`;
}

// Enhanced prompt that enforces strict formatting AND step count
// export function getStrictFormattedPrompt(task: string, projectContext: string): string {
//     return `You are an expert software architect creating a detailed implementation plan.

// PROJECT CONTEXT:
// ${projectContext}

// TASK TO IMPLEMENT:
// "${task}"

// CRITICAL REQUIREMENTS:
// 1. FORMATTING: You MUST format your response using EXACTLY this pattern:
//    Step 1: [detailed description]
//    Step 2: [detailed description]
//    Step 3: [detailed description]
//    ...and so on.

// 2. STEP COUNT: Generate EXACTLY 8-12 steps total. No more, no less.
//    - If the task is simple: aim for 8-10 steps
//    - If the task is complex: aim for 10-12 steps
//    - Break down or combine actions as needed to fit this range

// Do NOT use any other numbering format (no "1.", no "- Step 1", no "## Step 1").
// Each step must start with "Step X:" where X is the step number.

// CONTENT REQUIREMENTS:
// - Each step should be 2-4 sentences describing one complete action
// - Include specific file names, paths, and technical details
// - Mention required dependencies, packages, or configurations
// - Make each step actionable and self-contained
// - Group related sub-tasks into single steps when appropriate

// EXAMPLE FORMAT:
// Step 1: Create the main authentication service file at src/services/authService.js. Implement login() and logout() functions that handle JWT token generation and validation. Include error handling for invalid credentials and network failures.

// Step 2: Install required dependencies by running npm install jsonwebtoken bcrypt express-rate-limit. These packages will handle JWT operations, password hashing, and rate limiting for authentication endpoints.

// Now generate the implementation plan with EXACTLY 8-12 steps following this format:`;
// }

// Improved refine step function - asks for alternatives instead of more detail
export async function refineStep(openai: OpenAI, originalStep: string, allSteps: string[], stepIndex: number, taskContext: string, projectContext: string): Promise<string> {
    try {
        const otherSteps = allSteps
            .map((step, idx) => `Step ${idx + 1}: ${step}`)
            .filter((_, idx) => idx !== stepIndex)
            .join('\n');

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [
                { 
                    role: "system", 
                    content: `You are an expert software architect helping to improve implementation plans. A user rejected a step, meaning they want a DIFFERENT approach, not more detail.\n\nGUIDELINES:\n- Suggest a completely different approach or method for achieving the same goal\n- Consider alternative technologies, patterns, or architectures\n- Think of creative solutions the user might not have considered\n- Keep it practical and implementable\n- Format as plain text without markdown formatting (no ** or ## or bullets)\n- Make it concise but complete (2-4 sentences)\n- Focus on WHAT and HOW, be specific about files/commands when helpful`
                },
                { 
                    role: "user", 
                    content: `The user rejected this step from their implementation plan:\n\nREJECTED STEP: "${originalStep}"\n\nCONTEXT - This was part of a plan for: "${taskContext}"\n\nOTHER STEPS IN THE PLAN:\n${otherSteps}\n\nPROJECT CONTEXT: "${projectContext}"\n\nThe user wants a different approach for this step. Suggest an alternative way to accomplish the same goal. Avoid markdown formatting - use plain text only.`
                }
            ],
            temperature: 0.4, // Slightly higher for creativity
            max_tokens: 300,
        });
        
        const refinedStep = response.choices[0].message?.content?.trim() || "Failed to refine step.";
        
        // Clean up any remaining markdown formatting
        return cleanMarkdown(refinedStep);
    } catch (error) {
        console.error('Error refining step:', error);
        return `Error generating alternative: ${error instanceof Error ? error.message : String(error)}`;
    }
}
