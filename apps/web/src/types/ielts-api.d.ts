// The backend is a CommonJS build loaded at runtime (see lib/backend.ts); only the bits we use are typed.
declare module '@ielts/api/dist/app' {
  export function createApp(logger?: false | ('log' | 'warn' | 'error')[]): Promise<{
    app: { listen(port: number, host: string): Promise<unknown>; getUrl(): Promise<string> };
  }>;
}
declare module '@ielts/api/dist/jobs/scheduler.service' {
  export const SchedulerService: new (...args: never[]) => {
    tick(budgetMs?: number): Promise<Record<string, unknown>>;
  };
}
