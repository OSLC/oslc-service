/**
 * OSLC Service Integration Tests
 * Tests that verify the service produces correct RDF across formats,
 * and that the Express middleware integrates properly.
 */

const request = require('supertest');
const createApp = require('../test-server.js');
const media = require('../media.js');

describe('RDF Serialization Integration', () => {
    let app;

    beforeEach(() => {
        app = createApp();
    });

    test('Turtle output contains RDF triples', async () => {
        const response = await request(app)
            .get('/r/myresource')
            .set('Accept', media.turtle)
            .expect(200);

        expect(response.text).toContain('@prefix');
    });

    test('JSON-LD output is parseable JSON', async () => {
        const response = await request(app)
            .get('/r/myresource')
            .set('Accept', media.jsonld)
            .expect(200);

        expect(() => JSON.parse(response.text)).not.toThrow();
    });

    test('RDF/XML output contains rdf:RDF root element', async () => {
        const response = await request(app)
            .get('/r/myresource')
            .set('Accept', media.rdfxml)
            .expect(200);

        expect(response.text).toContain('rdf:RDF');
    });

    test('same resource returns consistent ETag across requests', async () => {
        const res1 = await request(app)
            .get('/r/consistent')
            .expect(200);

        const res2 = await request(app)
            .get('/r/consistent')
            .expect(200);

        expect(res1.headers.etag).toBe(res2.headers.etag);
    });
});

describe('Middleware Chain Integration', () => {
    test('service mounts on an Express app without errors', () => {
        expect(() => createApp()).not.toThrow();
    });

    test('requests outside the context path are not handled', async () => {
        const app = createApp();

        const response = await request(app).get('/other/test');
        expect(response.status).toBe(404);
    });
});
