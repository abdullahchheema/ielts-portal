/** Emitted when a full simulator attempt reaches DONE. Feedback listens for it to ask for a mock-exam response. */
export const SIMULATOR_COMPLETED = 'simulator.completed';
export interface SimulatorCompleted { studentId: string; examAttemptId: string }
