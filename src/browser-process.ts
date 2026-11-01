// Browser shims for the SDK's path/util dependencies. No Node APIs are exposed.
export const process = {
  env: { NODE_ENV: 'production' },
  platform: 'browser',
  cwd: () => '/',
  nextTick: (callback: (...args: any[]) => void, ...args: any[]) => queueMicrotask(() => callback(...args)),
};
export const global = globalThis;
