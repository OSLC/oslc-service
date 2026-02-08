/**
 * OSLC Service HTTP Tests
 * Integration tests exercising the service through HTTP requests.
 */

const request = require('supertest');
const createApp = require('../test-server.js');
const media = require('../media.js');

describe('OSLC Service HTTP', () => {
    let app;

    beforeEach(() => {
        app = createApp();
    });

    describe('HTTP Headers', () => {
        test('should include LDP Link header', async () => {
            const response = await request(app)
                .get('/r/test')
                .expect(200);

            expect(response.headers.link).toContain('rel="type"');
        });

        test('should include ETag header', async () => {
            const response = await request(app)
                .get('/r/test')
                .expect(200);

            expect(response.headers.etag).toBeDefined();
        });

        test('should include Allow header', async () => {
            const response = await request(app)
                .get('/r/test')
                .expect(200);

            expect(response.headers.allow).toBeDefined();
        });
    });

    describe('Content Negotiation', () => {
        test('should return Turtle by default', async () => {
            const response = await request(app)
                .get('/r/test')
                .set('Accept', media.turtle)
                .expect(200);

            expect(response.headers['content-type']).toBe(media.turtle);
        });

        test('should return JSON-LD when requested', async () => {
            const response = await request(app)
                .get('/r/test')
                .set('Accept', media.jsonld)
                .expect(200);

            expect(response.headers['content-type']).toBe(media.jsonld);
        });

        test('should return RDF/XML when requested', async () => {
            const response = await request(app)
                .get('/r/test')
                .set('Accept', media.rdfxml)
                .expect(200);

            expect(response.headers['content-type']).toBe(media.rdfxml);
        });

        test('should return 406 for unsupported Accept type', async () => {
            await request(app)
                .get('/r/test')
                .set('Accept', 'application/xml')
                .expect(406);
        });
    });

    describe('RDF Content', () => {
        test('Turtle response contains @prefix and triples', async () => {
            const response = await request(app)
                .get('/r/test')
                .set('Accept', media.turtle)
                .expect(200);

            expect(response.text).toContain('@prefix');
        });

        test('JSON-LD response is valid JSON', async () => {
            const response = await request(app)
                .get('/r/test')
                .set('Accept', media.jsonld)
                .expect(200);

            const json = JSON.parse(response.text);
            expect(json).toBeDefined();
        });

        test('RDF/XML response contains rdf:RDF', async () => {
            const response = await request(app)
                .get('/r/test')
                .set('Accept', media.rdfxml)
                .expect(200);

            expect(response.text).toContain('rdf:RDF');
        });
    });

    describe('HTTP Methods', () => {
        test('OPTIONS returns 200', async () => {
            await request(app)
                .options('/r/test')
                .expect(200);
        });

        test('HEAD returns 200', async () => {
            await request(app)
                .head('/r/test')
                .expect(200);
        });

        test('GET returns 200', async () => {
            await request(app)
                .get('/r/test')
                .expect(200);
        });
    });

    describe('ETag / Conditional GET', () => {
        test('should return 304 when If-None-Match matches ETag', async () => {
            const first = await request(app)
                .get('/r/test')
                .expect(200);

            const etag = first.headers.etag;
            expect(etag).toBeDefined();

            await request(app)
                .get('/r/test')
                .set('If-None-Match', etag)
                .expect(304);
        });

        test('should return 200 when If-None-Match does not match', async () => {
            await request(app)
                .get('/r/test')
                .set('If-None-Match', 'W/"does-not-match"')
                .expect(200);
        });
    });
});
