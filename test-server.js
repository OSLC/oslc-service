/**
 * Test server for oslc-service integration tests.
 * Creates an Express app with a mock storage backend.
 * Does NOT call app.listen() - supertest works directly with the app.
 */

const oslcService = require('./service.js');
const express = require('express');
const rdflib = require('rdflib');
const media = require('./media.js');

var RDF = rdflib.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
var LDP = rdflib.Namespace('http://www.w3.org/ns/ldp#');
var RDFS = rdflib.Namespace("http://www.w3.org/2000/01/rdf-schema#");

/**
 * In-memory storage service that satisfies the interface expected by ldp.js.
 * Resources are auto-created on first read with default RDF triples.
 * Deleted resources return 404 on subsequent reads.
 */
function createMockStorage() {
    var resources = {};
    var deleted = {};

    return {
        read: function(uri, callback) {
            if (deleted[uri]) {
                callback(404);
                return;
            }
            if (resources[uri]) {
                callback(200, resources[uri]);
            } else {
                // Auto-create a default RDF document on first read
                var doc = rdflib.graph();
                doc.uri = uri;
                doc.add(
                    rdflib.sym(uri),
                    RDF('type'),
                    LDP('Resource')
                );
                doc.add(
                    rdflib.sym(uri),
                    RDFS('label'),
                    rdflib.literal('Test Resource')
                );
                resources[uri] = doc;
                callback(200, doc);
            }
        },
        update: function(document, callback) {
            resources[document.uri] = document;
            delete deleted[document.uri];
            callback(201);
        },
        remove: function(uri, callback) {
            delete resources[uri];
            deleted[uri] = true;
            callback(200);
        },
        reserveURI: function(uri, callback) {
            if (resources[uri]) {
                callback(409);
            } else {
                callback(201);
            }
        },
        releaseURI: function(uri) {
            delete resources[uri];
        },
        getMembershipTriples: function(container, callback) {
            callback(200, []);
        },
        insertData: function(data, uri, callback) {
            callback(200);
        }
    };
}

/**
 * Creates an Express app with the OSLC service middleware and
 * PUT/DELETE handlers that exercise the mock storage.
 *
 * service.js stubs PUT/POST/DELETE with next(), so they fall through
 * to these handlers. req.fullURL and req.rawBody are set by the
 * oslc sub-app middleware before falling through.
 */
function createApp() {
    var app = express();
    var storage = createMockStorage();
    var env = {
        appBase: 'http://localhost:3000',
        context: '/r/',
        services: [],
        storageService: storage
    };
    app.use(oslcService(env));

    // PUT: parse RDF body and store
    app.put('/r/{*splat}', function(req, res) {
        var contentType = req.get('Content-Type') || media.turtle;
        var doc = rdflib.graph();
        doc.uri = req.fullURL;
        rdflib.parse(req.rawBody, doc, req.fullURL, contentType, function(err) {
            if (err) {
                res.status(400).send('Bad request\n');
                return;
            }
            storage.update(doc, function(status) {
                res.sendStatus(status);
            });
        });
    });

    // DELETE: remove from storage
    app.delete('/r/{*splat}', function(req, res) {
        storage.remove(req.fullURL, function(status) {
            res.sendStatus(status);
        });
    });

    return app;
}

module.exports = createApp;
