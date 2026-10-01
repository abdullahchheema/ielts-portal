// The backend is a CommonJS build loaded at runtime (see lib/backend.ts); only the bits we use are typed.
declare module '@ielts/api/dist/app' {
  export function createApp(logger?: false | ('log' | 'warn' | 'error')[]): Promise<{
    app: { listen(port: number, host: string): Promise<unknown>; getUrl(): Promise<string> };
  }>;
}
declare module '@ielts/api/dist/lifecycle/lifecycle.service' {
  export const LifecycleService: new (...args: never[]) => unknown;
}
declare module '@ielts/api/dist/assessments/attempts.service' {
  export const AttemptsService: new (...args: never[]) => unknown;
}
