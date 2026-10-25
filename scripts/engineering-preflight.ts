import { limits, modelPolicy, protectedOperations, statuses, validationCommands } from "../src/lib/engineering/policy";

// A deterministic policy manifest; no model, shell executor, DB or remote writes.
console.log(JSON.stringify({ schemaVersion: 1, executionEnabled: false, statuses, limits, modelPolicy, protectedOperations, validationCommands }, null, 2));
