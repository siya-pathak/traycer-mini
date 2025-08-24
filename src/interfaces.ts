export interface PlanStep {
    id: string;
    content: string;
    status?: 'accepted' | 'rejected' | 'edited' | 'refining';
    originalIndex: number;
}

export interface PlanState {
    steps: PlanStep[];
    taskDescription: string;
    lastModified: Date;
}
