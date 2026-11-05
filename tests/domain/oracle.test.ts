import { describe, expect, it } from 'vitest';
import { legacy, legacyDemo } from '../oracle';

describe('legacy oracle', () => {
  it('loads the full v6 domain API', () => {
    expect(legacy.VERSION).toBe(6);
    expect(typeof legacy.migrate).toBe('function');
    expect(typeof legacy.validate).toBe('function');
  });

  it('demo seed validates and matches the documented dashboard totals', () => {
    const s = legacyDemo.seed();
    expect(legacy.validate(s)).toBeTruthy();
    expect(s.schemaVersion).toBe(6);
    expect(s.ingredients).toHaveLength(8);
    expect(s.units).toHaveLength(6);
  });
});
