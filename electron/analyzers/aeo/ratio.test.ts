import { describe, it, expect } from 'vitest';
import { jsDependencyRatio } from './index';

describe('jsDependencyRatio', () => {
	it('returns 1 when all content is present without JavaScript', () => {
		expect(jsDependencyRatio('hello world', 'hello world')).toBe(1);
	});

	it('returns near zero when content only appears after JavaScript runs', () => {
		expect(jsDependencyRatio('', 'a lot of rendered content here')).toBe(0);
	});

	it('returns a fraction for partial server rendering', () => {
		expect(jsDependencyRatio('12345', '1234567890')).toBeCloseTo(0.5);
	});

	it('returns 1 when the rendered page is empty, to avoid dividing by zero', () => {
		expect(jsDependencyRatio('', '')).toBe(1);
	});

	it('never exceeds 1 when raw text is longer than rendered', () => {
		expect(jsDependencyRatio('longer raw text', 'short')).toBe(1);
	});
});
