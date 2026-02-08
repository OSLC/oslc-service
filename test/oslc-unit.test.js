/**
 * OSLC Service Unit Tests
 * Tests for module exports, media types, and configuration
 * without making HTTP requests.
 */

const oslcService = require('../service.js');
const media = require('../media.js');

describe('Module Exports', () => {
    test('service.js exports a function', () => {
        expect(typeof oslcService).toBe('function');
    });

    test('returns an Express sub-app (function)', () => {
        const env = {
            appBase: 'http://localhost:3000',
            context: '/r/',
            services: []
        };
        const middleware = oslcService(env);
        expect(typeof middleware).toBe('function');
    });
});

describe('Media Types', () => {
    test('defines all required OSLC media types', () => {
        expect(media.turtle).toBe('text/turtle');
        expect(media.jsonld).toBe('application/ld+json');
        expect(media.json).toBe('application/json');
        expect(media.n3).toBe('text/n3');
        expect(media.text).toBe('text/plain');
    });
});

describe('Configuration', () => {
    test('accepts minimal configuration', () => {
        expect(() => oslcService({
            appBase: 'http://localhost:3000',
            context: '/r/'
        })).not.toThrow();
    });

    test('accepts configuration with services', () => {
        expect(() => oslcService({
            appBase: 'http://localhost:3000',
            context: '/r/',
            services: [{ name: 'test', uri: 'http://localhost:3000/services/test' }]
        })).not.toThrow();
    });

    test('accepts different context paths', () => {
        ['/r/', '/resources/', '/api/'].forEach(context => {
            expect(() => oslcService({
                appBase: 'http://localhost:3000',
                context: context
            })).not.toThrow();
        });
    });
});
