/**
 * Legacy oracle: loads the untouched v0.8.1 prototype domain layer (legacy/assets/*-core.js)
 * so the new TypeScript domain can be checked against it scenario by scenario.
 * legacy/ must never be edited — it is the executable spec.
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Legacy = Record<string, any>;

/** Full legacy API (core → … → workflow-core), schemaVersion 6. */
export const legacy: Legacy = require('../legacy/assets/workflow-core.js');
/** Legacy demo dataset builder (`seed()`), consistent across every rule. */
export const legacyDemo: Legacy = require('../legacy/assets/demo-data.js');
/** Individual layers, for layer-by-layer parity while porting. */
export const legacyLayer = (name: string): Legacy => require(`../legacy/assets/${name}.js`);
