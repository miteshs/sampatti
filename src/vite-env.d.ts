/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Shared token sent as `x-app-token` to the relay, matching the worker's APP_TOKEN
  // secret. Baked in at build time from .env.local (gitignored); empty if unset.
  readonly VITE_RELAY_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
