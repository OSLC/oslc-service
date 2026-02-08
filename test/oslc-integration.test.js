/**
 * OSLC Service Integration Tests
 * Tests that verify the service produces correct RDF across formats,
 * and lifecycle tests that exercise the full mock storage interface.
 */

const request = require('supertest');
const createApp = require('../test-server.js');
const media = require('../media.js');

describe('RDF Serialization', () => {
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

describe('Resource Lifecycle', () => {
    let app;

    beforeEach(() => {
        app = createApp();
    });

    test('GET → DELETE → GET (404): read then remove a resource', async () => {
        // GET: auto-creates and returns the resource (exercises storage.read)
        const getRes = await request(app)
            .get('/r/lifecycle')
            .set('Accept', media.turtle)
            .expect(200);

        expect(getRes.text).toContain('@prefix');
        expect(getRes.headers.etag).toBeDefined();

        // DELETE: removes the resource (exercises storage.remove)
        await request(app)
            .delete('/r/lifecycle')
            .expect(200);

        // GET again: resource is gone (exercises storage.read returning 404)
        await request(app)
            .get('/r/lifecycle')
            .set('Accept', media.turtle)
            .expect(404);
    });

    test('PUT → GET: store a resource and read it back', async () => {
        const turtle = [
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            '@prefix ldp: <http://www.w3.org/ns/ldp#> .',
            '<http://localhost:3000/r/newresource> a ldp:Resource ;',
            '    rdfs:label "My New Resource" .'
        ].join('\n');

        // PUT: create/update the resource (exercises storage.update)
        await request(app)
            .put('/r/newresource')
            .set('Content-Type', media.turtle)
            .send(turtle)
            .expect(201);

        // GET: read back the stored resource (exercises storage.read)
        const getRes = await request(app)
            .get('/r/newresource')
            .set('Accept', media.turtle)
            .expect(200);

        expect(getRes.text).toContain('My New Resource');
    });

    test('PUT → GET → DELETE → GET (404): full create-read-delete cycle', async () => {
        const turtle = [
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            '<http://localhost:3000/r/full-cycle> rdfs:label "Full Cycle" .'
        ].join('\n');

        // PUT: create the resource
        await request(app)
            .put('/r/full-cycle')
            .set('Content-Type', media.turtle)
            .send(turtle)
            .expect(201);

        // GET: verify it exists and content is correct
        const getRes = await request(app)
            .get('/r/full-cycle')
            .set('Accept', media.turtle)
            .expect(200);

        expect(getRes.text).toContain('Full Cycle');

        // DELETE: remove it
        await request(app)
            .delete('/r/full-cycle')
            .expect(200);

        // GET: verify it's gone
        await request(app)
            .get('/r/full-cycle')
            .set('Accept', media.turtle)
            .expect(404);
    });

    test('PUT → PUT → GET: updating a resource overwrites previous content', async () => {
        const turtleV1 = [
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            '<http://localhost:3000/r/versioned> rdfs:label "Version 1" .'
        ].join('\n');

        const turtleV2 = [
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            '<http://localhost:3000/r/versioned> rdfs:label "Version 2" .'
        ].join('\n');

        // PUT v1
        await request(app)
            .put('/r/versioned')
            .set('Content-Type', media.turtle)
            .send(turtleV1)
            .expect(201);

        // PUT v2 (overwrite)
        await request(app)
            .put('/r/versioned')
            .set('Content-Type', media.turtle)
            .send(turtleV2)
            .expect(201);

        // GET: should have v2 content
        const getRes = await request(app)
            .get('/r/versioned')
            .set('Accept', media.turtle)
            .expect(200);

        expect(getRes.text).toContain('Version 2');
        expect(getRes.text).not.toContain('Version 1');
    });

    test('PUT changes the ETag', async () => {
        // GET: auto-created resource with default ETag
        const before = await request(app)
            .get('/r/etag-change')
            .set('Accept', media.turtle)
            .expect(200);

        const turtle = [
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            '<http://localhost:3000/r/etag-change> rdfs:label "Different Content" .'
        ].join('\n');

        // PUT: update with different content
        await request(app)
            .put('/r/etag-change')
            .set('Content-Type', media.turtle)
            .send(turtle)
            .expect(201);

        // GET: ETag should differ from the auto-created version
        const after = await request(app)
            .get('/r/etag-change')
            .set('Accept', media.turtle)
            .expect(200);

        expect(before.headers.etag).toBeDefined();
        expect(after.headers.etag).toBeDefined();
        expect(before.headers.etag).not.toBe(after.headers.etag);
    });

    test('DELETE → PUT → GET: re-create a deleted resource', async () => {
        // GET: auto-create
        await request(app)
            .get('/r/phoenix')
            .expect(200);

        // DELETE
        await request(app)
            .delete('/r/phoenix')
            .expect(200);

        // Verify gone
        await request(app)
            .get('/r/phoenix')
            .expect(404);

        // PUT: re-create
        const turtle = [
            '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
            '<http://localhost:3000/r/phoenix> rdfs:label "Reborn" .'
        ].join('\n');

        await request(app)
            .put('/r/phoenix')
            .set('Content-Type', media.turtle)
            .send(turtle)
            .expect(201);

        // GET: resource is back
        const getRes = await request(app)
            .get('/r/phoenix')
            .set('Accept', media.turtle)
            .expect(200);

        expect(getRes.text).toContain('Reborn');
    });
});

describe('Middleware Chain', () => {
    test('service mounts on an Express app without errors', () => {
        expect(() => createApp()).not.toThrow();
    });

    test('requests outside the context path are not handled', async () => {
        const app = createApp();

        const response = await request(app).get('/other/test');
        expect(response.status).toBe(404);
    });
});
