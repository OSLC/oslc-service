/*
 * Copyright 2014 IBM Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * server.js is Express middleware that handles HTTP requests for OSLC resources.
 */

var express = require('express');
var fs = require('fs');
var path = require('path');
var http = require('http');
var https = require('https');
var rdflib = require('rdflib')
var media = require('./media.js'); // media types

var	appBase = null; // Used to formlate the full URI for absolute URLs in the database


/*
 * Middleware to set the full URI for the request for use in 
 * storage identifiers.
 */
var fullURL = function fullURL(req, res, next) {
	req.fullURL = appBase + req.originalUrl;
	next();
}

/* 
 * Middleware to create a UTF8 encoded copy of the original request body
 * used in JSON and N3 parsers.
 */
var rawBody = function rawBody(req, res, next) {
	req.rawBody = '';
	req.setEncoding('utf8');

	req.on('data', function(chunk) {
		req.rawBody += chunk;
	});

	req.on('end', function() {
		next();
	});
}


/*
 * Middleware to handle all OSLC requests
 */
var oslcRoutes = function(env) {
	// some useful global variables added to exports
	var ldp = require('./vocab/ldp.js'); // LDP vocabulary
	var rdf = require('./vocab/rdf.js'); // RDF vocabulary
	var oslc = require('./vocab/oslc.js');
	var ldpService = require('./ldp');
	ldpService.init(env);
	
	var oslcApp = express();
	oslcApp.use(fullURL);
	oslcApp.use(rawBody);

	// anything not previously handled will be handled by oslcApp
	var oslcRoute = oslcApp.route(env.context+'*');

	// route any requests matching the LDP context (defaults to /r/*)
	oslcRoute.all(function(req, res, next) {
		// all responses should have Link: <ldp:Resource> rel=type
		var links = {
			type: ldp.Resource
		}
		// also include implementation constraints
		links[ldp.constrainedBy] = env.appBase + '/constraints.html'
		res.links(links)
		next()
	});

	oslcRoute.options(function(req, res, next) {
		ldpService.options(req, res, (status) => {
			res.status(status).end(); 			
		});
	});

	// Also handles head
	oslcRoute.get(function(req, res, next) {
		// look for Accept=application/x-oslc-compact+xml for Compact representation
		// Handle selective properties
		ldpService.get(req, res, (status, document) => {
			if (status !== 200) {
				res.status(status).send(`Cannot get resource ${req.originalUrl}\n`);
				return;
			}
			// determine what format to serialize using the Accept header
			var serialize
			if (req.accepts(media.turtle)) {
				serialize = media.turtle
			} else if (req.accepts(media.jsonld) || req.accepts(media.json)) {
				serialize = media.jsonld
			} else if (req.accepts(media.rdfxml)) {
				serialize = media.rdfxml
			} else {
				res.status(406).send('Not allowed\n');
				return;
			}
			// Serialize the resource
			// target must be undefined, and base set to an unused prefix to get the proper namespaces and URIs
			rdflib.serialize(document.sym(req.fullURL), document, "none:", serialize, function(err, content) {
				if (err) {
					console.log(err.stack);
					res.status(500).send(`Error searializing ${req.fullURL}\n`);
					return;
				}
				// generate an ETag for the content
				var eTag = ldpService.getETag(content);
				if (req.get('If-None-Match') === eTag) {
					res.status(304).send(`ETag did not match on ${req.fullURL}\n`);
					return;
				}

				res.setHeader('ETag', eTag);
				res.setHeader('Content-Type', serialize);
				res.status(200).send(new Buffer(content));
			});
		});
	});

	
	oslcRoute.post(function(req, res, next) {
		// handled by ldp-service
		next();
	});


	oslcRoute.put(function(req, res, next) {
		// handled by ldp-service
		next();
	});

	oslcRoute.delete(function(req, res, next) {
		// handled by ldp-service
		next();
	});
	return oslcApp;
}

module.exports = function(env) {
	// initialize the database from the ServiceProviderCatalog provided in the env
	appBase = env.appBase
	return oslcRoutes(env);
}