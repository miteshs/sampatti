/// <reference types="vite/client" />

// No app secrets are baked in — relay access is via a user-entered access code, never a
// build-time token. (ImportMetaEnv comes from vite/client.)

// App version, injected from package.json at build time (see vite.config.ts `define`).
declare const __APP_VERSION__: string;
