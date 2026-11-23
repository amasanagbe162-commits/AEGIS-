#!/usr/bin/env node
// Launcher. It exists in the repository so `npm install` can link the `aegis` command
// before the TypeScript build has produced dist/. The real program is dist/main.js.
import "../dist/main.js";
