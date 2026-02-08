/**
 * Test server for oslc-service integration tests.
 * Creates an Express app with a mock storage backend.
 * Does NOT call app.listen() - supertest works directly with the app.
 */

const oslcService = require('./service.js');
const express = require('express');
const rdflib = require('rdflib');

var RDF = rdflib.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
var LDP = rdflib.Namespace('http://www.w3.org/ns/ldp#');
var RDFS = rdflib.Namespace("http://www.w3.org/2000/01/rdf-schema#");

/**
 * In-memory storage service that satisfies the interface expected by ldp.js.
 */
function createMockStorage() {
    var resources = {};

    return {
        read: function(uri, callback) {
            if (resources[uri]) {
                callback(200, resources[uri]);
            } else {
                // Return a default RDF document for any requested URI
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
            callback(201);
        },
        remove: function(uri, callback) {
            delete resources[uri];
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

function createApp() {
    var app = express();
    var env = {
        appBase: 'http://localhost:3000',
        context: '/r/',
        services: [],
        storageService: createMockStorage()
    };
    app.use(oslcService(env));
    return app;
}

module.exports = createApp;
