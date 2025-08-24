// Note: cleanMarkdown and createEditableStepCard functions will be injected by the extension
// along with the planState object

(function () {
    const vscode = acquireVsCodeApi();

    let planState = { steps: [] }; 
    
    // Helper to clean HTML for display in contenteditable
    function cleanHtmlForContenteditable(html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('strong, em, code, br, ul, li').forEach(el => {
            if (el.tagName === 'BR') {
                el.outerHTML = '\n';
            } else if (el.tagName === 'LI') {
                el.outerHTML = `- ${el.innerHTML}\n`;
            } else {
                el.outerHTML = el.textContent || '';
            }
        });
        return doc.body.textContent || '';
    }
    
    function updateUI(newState) {
        planState = newState;
        const stepsContainer = document.querySelector('.steps-container');
        if (!stepsContainer) return;

        // Clear existing cards
        stepsContainer.innerHTML = '';

        // Render new cards and attach event listeners
        planState.steps.forEach(step => {
            const cardHtml = window.createEditableStepCard(step);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardHtml;
            const newCardElement = tempDiv.firstElementChild;
            if (newCardElement) {
                stepsContainer.appendChild(newCardElement);
                setupCardEventListeners(newCardElement);
            }
        });

        updateProgressDisplay();
        updateButtonStates();
    }

    function updateProgressDisplay() {
        const acceptedCount = planState.steps.filter(s => s.status === 'accepted').length;
        const totalCount = planState.steps.length;
        const progressPercent = totalCount > 0 ? Math.round((acceptedCount / totalCount) * 100) : 0;

        const progressFill = document.querySelector('.progress-fill');
        const progressText = document.querySelector('.progress-text');

        if (progressFill) progressFill.style.width = `${progressPercent}%`;
        if (progressText) progressText.textContent = `Progress: ${acceptedCount}/${totalCount} steps approved (${progressPercent}%)`;
    }

    function updateButtonStates() {
        planState.steps.forEach(step => {
            const card = document.querySelector(`.step-card[data-id="${step.id}"]`);
            if (!card) return;

            const acceptButton = card.querySelector('.accept-button');
            const rejectButton = card.querySelector('.reject-button');
            const editButton = card.querySelector('.edit-button');
            const saveEditButton = card.querySelector('.save-edit-button');
            const cancelEditButton = card.querySelector('.cancel-edit-button');
            const contentDiv = card.querySelector('.contenteditable-content');

            if (acceptButton) {
                if (step.status === 'accepted') {
                    acceptButton.textContent = '✓ Accepted';
                    acceptButton.disabled = true; // No type assertion needed for HTMLButtonElement
                } else {
                    acceptButton.textContent = '✓ Accept';
                    acceptButton.disabled = false; // No type assertion needed for HTMLButtonElement
                }
            }
            if (rejectButton) {
                if (step.status === 'rejected' || step.status === 'refining') {
                    rejectButton.textContent = '↻ Refining...';
                    rejectButton.disabled = true; // No type assertion needed for HTMLButtonElement
                } else {
                    rejectButton.textContent = '↻ Alternative';
                    rejectButton.disabled = false; // No type assertion needed for HTMLButtonElement
                }
            }
            if (editButton && saveEditButton && cancelEditButton && contentDiv) {
                if (contentDiv.contentEditable === 'true') {
                    editButton.style.display = 'none';
                    saveEditButton.style.display = 'inline-block';
                    cancelEditButton.style.display = 'inline-block';
                } else {
                    editButton.style.display = 'inline-block';
                    saveEditButton.style.display = 'none';
                    cancelEditButton.style.display = 'none';
                }
            }
        });
    }

    function enterEditMode(stepId) {
        const card = document.querySelector(`.step-card[data-id="${stepId}"]`);
        const contentDiv = card?.querySelector('.contenteditable-content');
        const currentStep = planState.steps.find(s => s.id === stepId);
        if (card && contentDiv && currentStep) {
            card.classList.add('editing');
            contentDiv.contentEditable = 'true';
            contentDiv.focus();
            contentDiv.dataset.originalContent = cleanHtmlForContenteditable(contentDiv.innerHTML);
            updateButtonStates();
        }
    }

    function exitEditMode(stepId, save) {
        const card = document.querySelector(`.step-card[data-id="${stepId}"]`);
        const contentDiv = card?.querySelector('.contenteditable-content');
        if (card && contentDiv) {
            card.classList.remove('editing');
            contentDiv.contentEditable = 'false';

            if (save) {
                const newContent = contentDiv.textContent || '';
                const originalContent = planState.steps.find(s => s.id === stepId)?.content;
                if (newContent !== originalContent) {
                    vscode.postMessage({ command: 'editStep', id: stepId, content: newContent });
                }
            } else {
                if (contentDiv.dataset.originalContent !== undefined) {
                    contentDiv.innerHTML = window.cleanMarkdown(contentDiv.dataset.originalContent);
                }
            }
            updateButtonStates();
        }
    }

    function addStep(afterId) {
        vscode.postMessage({ command: 'addStep', afterId: afterId, content: 'New plan step.' });
    }

    function deleteStep(stepId) {
        if (confirm('Are you sure you want to delete this step?')) {
            console.log(`Webview: Deleting step with id: ${stepId}`);
            vscode.postMessage({ command: 'deleteStep', id: stepId });
        }
    }

    function saveExportPlan() {
        vscode.postMessage({ command: 'savePlan' });
    }

    let draggedItem = null;

    function setupCardEventListeners(cardElement) {
        const stepId = cardElement.dataset.id;
        if (!stepId) return;

        const contentDiv = cardElement.querySelector('.contenteditable-content');
        if (!contentDiv) return;

        const editButton = cardElement.querySelector('.edit-button');
        const saveEditButton = cardElement.querySelector('.save-edit-button');
        const cancelEditButton = cardElement.querySelector('.cancel-edit-button');
        const acceptButton = cardElement.querySelector('.accept-button');
        const rejectButton = cardElement.querySelector('.reject-button');
        
        const deleteButton = cardElement.querySelector('.delete-button');
        if (deleteButton) {
            deleteButton.addEventListener('click', () => {
                console.log(`Webview: Delete button clicked for stepId: ${stepId}`);
                vscode.postMessage({ command: 'deleteStep', id: stepId });
            });
        }

        if (acceptButton) {
            acceptButton.addEventListener('click', () => {
                console.log(`Webview: Accept button clicked for stepId: ${stepId}`);
                vscode.postMessage({ command: 'acceptStep', id: stepId });
            });
        }

        if (rejectButton) {
            rejectButton.addEventListener('click', () => {
                console.log(`Webview: Reject button clicked for stepId: ${stepId}`);
                vscode.postMessage({ command: 'rejectStep', id: stepId });
            });
        }

        if (editButton) {
            editButton.addEventListener('click', () => {
                console.log(`Webview: Edit button clicked for stepId: ${stepId}`);
                enterEditMode(stepId);
            });
        }

        if (saveEditButton) {
            saveEditButton.addEventListener('click', () => {
                console.log(`Webview: Save Edit button clicked for stepId: ${stepId}`);
                exitEditMode(stepId, true);
            });
        }

        if (cancelEditButton) {
            cancelEditButton.addEventListener('click', () => {
                console.log(`Webview: Cancel Edit button clicked for stepId: ${stepId}`);
                exitEditMode(stepId, false);
            });
        }
        const reorderUpButton = cardElement.querySelector('.reorder-up-button');
        const reorderDownButton = cardElement.querySelector('.reorder-down-button');
        if (reorderUpButton) {
            reorderUpButton.addEventListener('click', () => {
                const currentIndex = planState.steps.findIndex(s => s.id === stepId);
                if (currentIndex > 0) {
                    const newOrder = [...planState.steps];
                    [newOrder[currentIndex - 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex - 1]];
                    vscode.postMessage({ command: 'reorderSteps', newOrder: newOrder.map(s => s.id) });
                }
            });
        }

        if (reorderDownButton) {
            reorderDownButton.addEventListener('click', () => {
                const currentIndex = planState.steps.findIndex(s => s.id === stepId);
                if (currentIndex < planState.steps.length - 1) {
                    const newOrder = [...planState.steps];
                    [newOrder[currentIndex + 1], newOrder[currentIndex]] = [newOrder[currentIndex], newOrder[currentIndex + 1]];
                    vscode.postMessage({ command: 'reorderSteps', newOrder: newOrder.map(s => s.id) });
                }
            });
        }
        
        cardElement.addEventListener('dragstart', (e) => {
            draggedItem = cardElement;
            e.dataTransfer?.setData('text/plain', stepId);
            setTimeout(() => {
                cardElement.style.opacity = '0.5';
            }, 0);
        });

        cardElement.addEventListener('dragend', () => {
            cardElement.style.opacity = '1';
            draggedItem = null;
        });

        cardElement.addEventListener('dragover', (e) => {
            e.preventDefault();
            const boundingBox = cardElement.getBoundingClientRect();
            const offset = e.clientY - boundingBox.top;
            if (offset < boundingBox.height / 2) {
                cardElement.style.borderTop = '2px solid var(--vscode-editor-selectionHighlightBackground)';
                cardElement.style.borderBottom = '';
            } else {
                cardElement.style.borderBottom = '2px solid var(--vscode-editor-selectionHighlightBackground)';
                cardElement.style.borderTop = '';
            }
        });

        cardElement.addEventListener('dragleave', () => {
            cardElement.style.borderTop = '';
            cardElement.style.borderBottom = '';
        });

        cardElement.addEventListener('drop', (e) => {
            e.preventDefault();
            cardElement.style.borderTop = '';
            cardElement.style.borderBottom = '';

            const droppedId = e.dataTransfer?.getData('text/plain');
            if (droppedId && draggedItem) {
                const droppedIndex = planState.steps.findIndex(s => s.id === droppedId);
                const targetIndex = planState.steps.findIndex(s => s.id === stepId);

                if (droppedIndex !== -1 && targetIndex !== -1 && droppedIndex !== targetIndex) {
                    const newOrder = [...planState.steps];
                    const [removed] = newOrder.splice(droppedIndex, 1);

                    const boundingBox = cardElement.getBoundingClientRect();
                    const offset = e.clientY - boundingBox.top;
                    
                    if (offset < boundingBox.height / 2) {
                        newOrder.splice(targetIndex, 0, removed);
                    } else {
                        newOrder.splice(targetIndex + 1, 0, removed);
                    }
                    vscode.postMessage({ command: 'reorderSteps', newOrder: newOrder.map(s => s.id) });
                }
            }
        });
    }

    document.querySelectorAll('.step-card').forEach((card) => {
        setupCardEventListeners(card);
    });

    const addStepButton = document.querySelector('.add-step-button');
    if (addStepButton) {
        addStepButton.addEventListener('click', () => {
            const lastStepId = planState.steps.length > 0 ? planState.steps[planState.steps.length - 1].id : null;
            addStep(lastStepId);
        });
    }

    const savePlanButton = document.getElementById('savePlanButton');
    if (savePlanButton) {
        savePlanButton.addEventListener('click', saveExportPlan);
    }

    const sendToCopilotChatButton = document.getElementById('sendToCopilotChatButton');
    if (sendToCopilotChatButton) {
        sendToCopilotChatButton.addEventListener('click', () => {
            console.log('Webview: "Send to Copilot Chat" button clicked.');
            const copilotChatContent = window.formatForCopilotChat(planState);
            vscode.postMessage({ command: 'sendToCopilotChat', content: copilotChatContent });
        });
    }

    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            e.preventDefault();
            saveExportPlan();
        }
        if (e.key === 'Delete' && document.activeElement && document.activeElement.closest('.step-card')) {
            const focusedCard = document.activeElement.closest('.step-card');
            if (focusedCard && focusedCard.dataset.id) {
                deleteStep(focusedCard.dataset.id);
            }
        }
    });

    window.addEventListener('message', (event) => {
        const message = event.data;
        switch (message.command) {
            case 'stateUpdated':
                if (message.state) {
                    updateUI(message.state);
                }
                break;
            case 'getMarkdownContent':
                const markdown = window.exportPlanToMarkdown(planState);
                vscode.postMessage({ command: 'markdownContentResponse', content: markdown });
                break;
            // Removed 'updateStepStatus' as stateUpdated will handle full UI refresh
        }
    });

    // Set initial state from the injected global variable
    if (window.planState) {
        planState = window.planState;
    }

    updateProgressDisplay();
    updateButtonStates();

    // Ensure event listeners are set up for initially rendered cards
    document.querySelectorAll('.step-card').forEach((card) => {
        setupCardEventListeners(card);
    });
})();