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

/*
 * Middleware to handle all OSLC requests
 */
var oslcRoutes = function(env) {
	// some useful global variables added to exports
	var ldp = require('./vocab/ldp.js'); // LDP vocabulary
	var rdf = require('./vocab/rdf.js'); // RDF vocabulary
	var oslc = require('./vocab/oslc.js');
	
	var oslcApp = express();
	// anything not previously handled will be handled by oslcApp
	var oslcRoute = oslcApp.route(env.context+'*');

	// route any requests matching the LDP context (defaults to /r/*)
	oslcRoute.all(function(req, res, next) {
		// OSLC specific functions that apply to all HTTP methods

		next(); // then chain to ldp-service to do the rest
	});

	oslcRoute.options(function(req, res, next) {
		console.log('OSLC OPTIONS request on:'+req.path);
		next();
	});

	oslcRoute.head(function(req, res, next) {
		console.log('OSLC HEAD request on:'+req.path);
		next();
	});

	oslcRoute.get(function(req, res, next) {
		console.log('OSLC GET request on:'+req.path);
		next();
	});

	
	oslcRoute.post(function(req, res, next) {
		console.log('OSLC POST request on:'+req.path);
	});


	oslcRoute.put(function(req, res, next) {
		console.log('OSLC PUT request on:'+req.path);
	});

	oslcRoute.delete(function(req, res, next) {
		console.log('OSLC DELETE request on:'+req.path);
		next();
	});
	return oslcApp;
}

module.exports = function(env) {
	return oslcRoutes(env);
}