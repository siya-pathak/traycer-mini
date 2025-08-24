// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import OpenAI from 'openai';
import { generateNonce, getAdvancedWebviewContent } from './webviewProvider';
import { getOpenAiApiKey, getProjectContext, parsePlanIntoSteps, getStrictFormattedPrompt, refineStep } from './planService';

interface PlanStep {
    id: string;
    content: string;
    status?: 'accepted' | 'rejected' | 'edited';
    originalIndex: number;
}

interface PlanState {
    steps: PlanStep[];
    taskDescription: string;
    lastModified: Date;
}

type PlanMessage = 
    | { command: 'acceptStep'; id: string }
    | { command: 'rejectStep'; id: string }
    | { command: 'editStep'; id: string; content: string }
    | { command: 'reorderSteps'; newOrder: string[] }
    | { command: 'deleteStep'; id: string }
    | { command: 'addStep'; afterId: string | null; content: string }
    | { command: 'savePlan' }
    | { command: 'sendToCopilotChat'; content: string };

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Traycer Mini extension is now active!');

	let disposableHello = vscode.commands.registerCommand('traycer-mini.helloWorld', () => {
		vscode.window.showInformationMessage('Hello World from Traycer Mini!');
	});

	let disposableCopyToClipboard = vscode.commands.registerCommand('traycer-mini.copyPlanStepToClipboard', async (stepContent: string) => {
		if (stepContent) {
			await vscode.env.clipboard.writeText(stepContent);
			vscode.window.showInformationMessage('Plan step copied to clipboard!');
		} else {
			vscode.window.showWarningMessage('No content to copy for this plan step.');
		}
	});

	let disposableGeneratePlan = vscode.commands.registerCommand('traycer-mini.generatePlan', async () => {
        const apiKey = await getOpenAiApiKey();
        if (!apiKey) {
            vscode.window.showErrorMessage('OpenAI API Key not set. Please configure it in VS Code settings (traycer-mini.openaiApiKey).');
            return;
        }

        const openai = new OpenAI({ apiKey });

        // Utility to generate a unique ID for plan steps
        const generateStepId = (): string => crypto.randomUUID();

        // Utility to update originalIndex after reordering (for display/tracking purposes)
        const updateStepIndices = (steps: PlanStep[]): void => {
            steps.forEach((step, index) => {
                step.originalIndex = index + 1;
            });
        };

        // Basic validation for step operations
        const validateStepOperation = (id: string, steps: PlanStep[]): boolean => {
            return steps.some(step => step.id === id);
        };

        const task = await vscode.window.showInputBox({
            prompt: 'Enter a high-level task for implementation planning:',
            placeHolder: 'e.g., Add user authentication with JWT tokens',
            validateInput: (value) => {
                if (!value || value.trim().length < 10) {
                    return 'Please enter a more detailed task description (at least 10 characters)';
                }
                return null;
            }
        });

        if (!task) {
            vscode.window.showInformationMessage('Task input cancelled.');
            return;
        }

        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Analyzing project and generating plan...",
            cancellable: false
        }, async (progress) => {
            try {
                progress.report({ increment: 20, message: "Reading project context..." });
                const projectContext = await getProjectContext();
                
                progress.report({ increment: 30, message: "Generating implementation plan..." });
                
                // Enhanced prompt for better plan generation
                const strictPrompt = getStrictFormattedPrompt(task, projectContext);

				const response = await openai.chat.completions.create({
					model: "gpt-4o",
					messages: [
						{ 
							role: "system", 
							content: "You are a software architect. Always follow the exact formatting instructions provided. Start each step with 'Step X:' exactly as specified."
						},
						{ 
							role: "user", 
							content: strictPrompt 
						}
					],
					temperature: 0.1, // Very low temperature for consistent formatting
					max_tokens: 2500,
				});

                progress.report({ increment: 40, message: "Processing generated plan..." });

                const plan = response.choices[0].message?.content;
                if (plan) {
                    const rawSteps = parsePlanIntoSteps(plan);
                    
                    if (rawSteps.length === 0) {
                        vscode.window.showErrorMessage('Could not parse any actionable steps from the generated plan. Please try a more specific task description.');
                        return;
                    }
                    
                    let planState: PlanState = {
                        taskDescription: task,
                        lastModified: new Date(),
                        steps: rawSteps.map((content, index) => ({
                            id: generateStepId(),
                            content,
                            originalIndex: index + 1,
                            status: undefined
                        }))
                    };

                    const nonce = generateNonce();

                    progress.report({ increment: 20, message: "Creating interactive plan view..." });

                    const panel = vscode.window.createWebviewPanel(
                        'traycerMiniPlan',
                        `📋 Plan: ${task.substring(0, 50)}${task.length > 50 ? '...' : ''}`,
                        vscode.ViewColumn.One,
                        {
                            enableScripts: true,
                            retainContextWhenHidden: true
                        }
                    );
                    
                    panel.webview.html = getAdvancedWebviewContent(panel.webview, context.extensionUri, planState, nonce);

                    // Updated message handler with comprehensive step management
                    panel.webview.onDidReceiveMessage(async (message: PlanMessage) => {
                        let updated = false;
                        let stepIndex: number;
                        let stepToModify: PlanStep | undefined;

                        switch (message.command) {
                            case 'acceptStep':
                                stepToModify = planState.steps.find(s => s.id === message.id);
                                if (stepToModify) {
                                    stepToModify.status = 'accepted';
                                    updated = true;
                                }
                                break;

                            case 'rejectStep':
                                stepToModify = planState.steps.find(s => s.id === message.id);
                                if (stepToModify) {
                                    stepToModify.status = 'rejected';
                                    updated = true;

                                    panel.webview.postMessage({
                                        command: 'updateStepStatus',
                                        id: message.id,
                                        status: 'refining'
                                    });

                                    vscode.window.withProgress({
                                        location: vscode.ProgressLocation.Notification,
                                        title: "AI is generating an alternative approach...",
                                        cancellable: false
                                    }, async () => {
                                        const refinedContent = await refineStep(
                                            openai,
                                            stepToModify!.content,
                                            planState.steps.map(s => s.content),
                                            planState.steps.indexOf(stepToModify!),
                                            planState.taskDescription,
                                            projectContext
                                        );
                                        stepToModify!.content = refinedContent;
                                        stepToModify!.status = 'edited'; // Mark as edited after refinement
                                        planState.lastModified = new Date();
                                        panel.webview.postMessage({ command: 'stateUpdated', state: planState });
                                    });
                                }
                                break;

                            case 'editStep':
                                stepToModify = planState.steps.find(s => s.id === message.id);
                                if (stepToModify && stepToModify.content !== message.content) {
                                    stepToModify.content = message.content;
                                    stepToModify.status = 'edited';
                                    updated = true;
                                }
                                break;

                            case 'reorderSteps':
                                const newSteps: PlanStep[] = [];
                                message.newOrder.forEach(id => {
                                    const step = planState.steps.find(s => s.id === id);
                                    if (step) {
                                        newSteps.push(step);
                                    }
                                });
                                planState.steps = newSteps;
                                updateStepIndices(planState.steps); // Update originalIndex after reorder
                                updated = true;
                                break;

                            case 'deleteStep':
                                planState.steps = planState.steps.filter(s => s.id !== message.id);
                                updateStepIndices(planState.steps); // Update originalIndex after deletion
                                updated = true;
                                break;

                            case 'addStep':
                                const newStep: PlanStep = {
                                    id: generateStepId(),
                                    content: message.content,
                                    originalIndex: -1, // Will be updated by updateStepIndices
                                    status: 'edited'
                                };
                                if (message.afterId) {
                                    const afterIndex = planState.steps.findIndex(s => s.id === message.afterId);
                                    if (afterIndex !== -1) {
                                        planState.steps.splice(afterIndex + 1, 0, newStep);
                                    } else {
                                        planState.steps.push(newStep);
                                    }
                                } else {
                                    planState.steps.push(newStep);
                                }
                                updateStepIndices(planState.steps);
                                updated = true;
                                break;

                            case 'savePlan':
                                const markdownContent = getAdvancedWebviewContent(panel.webview, context.extensionUri, planState, nonce);
                                const document = await vscode.workspace.openTextDocument({ content: markdownContent, language: 'markdown' });
                                await vscode.window.showTextDocument(document);
                                vscode.window.showInformationMessage('Plan exported to a new untitled markdown document.');
                                break;

                            case 'sendToCopilotChat':
                                await vscode.env.clipboard.writeText(message.content);
                                vscode.window.showInformationMessage('Plan successfully copied to clipboard.');
                                break;
                        }

                        if (updated) {
                            planState.lastModified = new Date();
                            panel.webview.postMessage({ command: 'stateUpdated', state: planState });
                        }
                    });

                    progress.report({ increment: 10, message: "Complete!" });
                } else {
                    vscode.window.showErrorMessage('Failed to generate plan. Please try again.');
                }
            } catch (error: any) {
                vscode.window.showErrorMessage(`Error generating plan: ${error.message}`);
                console.error('Plan generation error:', error);
            }
        });
	});

	context.subscriptions.push(disposableHello, disposableGeneratePlan, disposableCopyToClipboard);
}

export function deactivate() {}
