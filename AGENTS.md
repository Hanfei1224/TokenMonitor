# TokenMonitor Agent Rules

## Persistent Storage Boundary

- Packaged builds must keep all application-owned persistent data inside the installation directory: the directory containing `TokenMonitor.exe`.
- Development builds must keep all application-owned persistent data inside the workspace development directory: `.dev-data` beside `src`.
- `config.json`, `stats_cache.json`, provider caches, Electron `userData`, and Electron `sessionData` must follow the selected environment root. Do not silently fall back to the other environment or to a shared user profile.
- `src/main/storagePath.ts` is the source of truth for selecting the environment root. Keep packaged and development data physically separate.
- Do not change either storage boundary without an explicit request. Any required migration must preserve existing files and encryption context, and must include an upgrade regression check.
