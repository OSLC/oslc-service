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
var xml2js = require('xml2js');
var xml_parser = xml2js.parseString; // Used to parse SPARQL results

/*
var rawBody = function(req, res, next) {
	req.rawBody = '';
	req.setEncoding('utf8');

	req.on('data', function(chunk) {
		req.rawBody += chunk;
	});

	req.on('end', function() {
		next();
	});
}*/

/*
 * Middleware to handle all OSLC requests
 */
var oslcRoutes = function(env) {
	var ldp = require('./vocab/ldp.js'); // LDP vocabulary
	var rdf = require('./vocab/rdf.js'); // RDF vocabulary
	var oslc = require('./vocab/oslc.js');
	var json = require('./jsonld.js');
	var turtle = require('./turtle.js');
	var crypto = require('crypto'); // for MD5 (ETags)
	var ldpService = undefined;

	if(env.dbType === 'Jena'){
		ldpService = require('../ldp-service-jena'); // OSLC is built on LDP. Uses the service that incorporates Apache Jena as the DB
	}else{
		ldpService = require('ldp-service');
	}

	var subApp = express();
	// subApp.use(rawBody);
	// anything those services don't handle will be passed to this service next
	var resource = subApp.route(env.context+"*");

	// route any requests matching the LDP context (defaults to /r/*)
	resource.all(function(req, res, next) {
		// all responses should have Link: <ldp:Resource> rel=type
		var links = {
			
		};
		// also include implementation constraints
		res.links(links);
		next();
	});

	subApp.get('/properties', function(req, res, next){
		console.log("PROPERTIES");
		var properties = getProperties(req.body);
		res.send(properties);
	});

	resource.options(function(req, res, next) {
		console.log('OSLC OPTIONS request on:'+req.path);
		next();
	});

	resource.head(function(req, res, next) {
		console.log('OSLC HEAD request on:'+req.path);
		next();
	});

	/*
		Searches for resource that contains the URL in order to check that
		it exists using a SPARQL query. If yes, conducts a check to make sure
		the content in the POST complies with the shape associated with the creation URI.
		This shape is saved locally during the initialization of the Jena database.
	*/
	resource.post(function(req, res, next) {
		console.log('OSLC POST request on:'+req.path);

		var the_query = "SELECT ?g WHERE { GRAPH ?g { ?s <http://open-services.net/ns/core#creation> <http://IBM762-PC09JBU1:3000"+req.originalUrl+"> } }";
		
		ldpService.db.query(encodeURIComponent(the_query), "application/ld+json", function(err, ires){
			if(ires.statusCode === 404){
				console.error("Creation URI does not exist");
				res.sendStatus(404);
			}else if(ires.statusCode === 400){
				console.error("Error with SPARQL query");
				res.sendStatus(400);
			}

			console.log("RESULT");

			check(req, res, function(result){
				console.log("HERE " + result);
				if(result[0]){
						res.sendStatus('500');
					}else if(result[1].length > 0){
						console.log("Not correct format for the inputted resource");
						res.sendStatus('400');
					}
					// console.log("EXECUTED9 " + next.stack);
					next();
					
				});

			});


		});
		
	});

	/*
		test strategy for Sam Padgett
		OSLC 3.0 test platform
		wrote a test case for each clause
		framework for executing and evaluating those cases
		see if server is OSLC 3.0 compliant
	*/

	resource.get(function(req, res, next) {
		console.log('OSLC GET request on:'+req.path);
		console.log(req.originalUrl);
		if(req.originalUrl.includes("?")){
			var base = req.originalUrl.substring(0, req.originalUrl.indexOf('?'));
			// Need to replace '/' w/ %2F to be in compliance w/ URI
			console.log("QUERY " + base);
			ldpService.db.query("SELECT%20DISTINCT%20%3Fg%20WHERE%20%7BGRAPH%20%3Fg%20%7B%3Fs%20http%3A%2F%2Fopen-services.net%2Fns%2Fcore%23queryBase%20"+base+"%20%7D%7D", "application/ld+json", function(err, ires){
				if(ires.statusCode === 404){
					console.error("Query URI does not exist");
					res.sendStatus(404);
				}

				var query = req.originalUrl.substring(req.originalUrl.indexOf('?')+1, req.originalUrl.length);
				var sparql_query_select = "SELECT ";
				var sparql_query_where = "WHERE GRAPH ?g {";
				var sparql_query_prefix = "";
				var sparql_query_orderBy = "ORDER BY ";

				// Construct SPARQL Query
				// Use resource shapes to determine that vocab used is accurate
				

					if(query.includes("oslc.prefix")){
	
						index = query.indexOf("oslc.select");

						for(var i = index; i < query.length && query.charAt(i) !== '&'; i++){

							if(query.charAt(i) === '=' || query.charAt(i) === '>' || query.charAt(i) === '<'){
									var resource = query.substring(index, i);
									index_follow = i;
									// check if param is valid
									// http://example.com/bugs?oslc.where=cm:severity="high" and dcterms:created>"2010-04-01"
						
									while(query.charAt(index_follow) != '&' && index_follow < query.length && query.charAt(index_follow) != ',' && query.charAt(index_follow) != '}'){
	
										index_follow++;

									}

									sparql_query+="PREFIX "+resource+": " + query.substring(i, index_follow)+" ";

									i = index_follow;
									index = i;
								}	
						}

					}

					
					if(query.includes("oslc.select")){
						index = query.indexOf("oslc.select")+"oslc.select=".length;
						var stack = new Array(); // Used to add to WHERE clause if there are nested properties

						var open_curl = 0;
						var close_curl = 0;
						
						stack.push("?s");
						var resource = "";
						for(var i = index+1; i < query.length && query.charAt(i) !== '&'; i++){

							if(query.charAt(i) === ','){
								resource = query.substring(index, i);
								sparql_query_select += "?"+resource+" ";
								sparql_query_where += stack.peek() + " " + resource + " ?" + resource;
								index = i;

								// check if param is valid
								// http://example.com/bugs?oslc.where=cm:severity="high" and dcterms:created>"2010-04-01"
								// http://example.com/bugs?oslc.select=dcterms:created,dcterms:creator{foaf:familyName}&oslc.where=cm:severity="high"
								// 
								// SELECT ?dcterms:created, ?foaf:familyName WHERE GRAPH ?g {?s cm:severity "high". ?s dcterms:created ?dcterms:created. ?s dcterms:creator ?dcterms:creator. ?dcterms:creator foaf:familyName ?foaf:familyName}
								// 
									
							}

							// Check that # of '{' === # of '}'
							// Assumption is that there needs to be a resource before the nested property in order to use it
							if(query.charAt(i) === '{'){
								if(query.charAt(i+1) === '{'){
									console.error("No identifiable property for the nested property");
									res.send("401");
								}
								resource = query.substring(index, i);
								index = i;
								stack.push("?"+resource);
								
							}

							if(query.charAt(i) === '}'){

								if(stack.peek() !== "?s"){
									resource = query.substring(index, i);
									sparql_query_select += " ?"+resource;
									sparql_query_where += stack.peek() + " " + resource + " ?" + resource;
									stack.pop();
									index = i;
									
								}
							}

						}

						if(open_curl > close_curl || close_curl > open_curl){
							console.error("Invalid query request");
							res.send("401");
						}

					}

					if(query.include("oslc.prefix")){
						index = query.indexOf('')
					}

					if(query.include("oslc.where")){
						var pred;
						var subj;

						var index = query.indexOf("oslc.where")+"oslc.where=".length;
						var index_follow;
						for(var i = index; i < query.length && query.charAt(i) !== '&'; i++){

								if(query.charAt(i) === '=' || query.charAt(i) === '>' || query.charAt(i) === '<'){
									var resource = query.substring(index, i);
									index_follow = i;
									// check if param is valid
									// http://example.com/bugs?oslc.where=cm:severity="high" and dcterms:created>"2010-04-01"
						
									while(query.charAt(index_follow) != '&' && index_follow < query.length && query.charAt(index_follow) != ' ' && query.charAt(index_follow) != '}'){
	
										index_follow++;

									}

									
									sparql_query_where+="?s " + resource + " " + query.substring(i, index_follow) + " . ";
									i = index_follow;
									index = i;
								}

								if(query.charAt(i) === ' '){
									if(query.substring(i+1, i+4) === "and"){
										index = i+5;
									}
								}

								if(query.charAt(i) === '{'){
									var resource = query.substring(index, i);
									sparql_query_where += "?s " + resource + " ?o . ";
									// do recursion, but utnil '}' is executed, return last index
									index = i+1;
								}


						}

						sparql_query_where += "} ";

						
					}

					if(query.includes(oslc.orderBy)){
	
						var index = query.indexOf("oslc.orderBy")+"oslc.orderBy=".length;
						var index_follow;
						for(var i = index; i < query.length && query.charAt(i) !== '&'; i++){

							if(query.charAt(i) === '+'){

								index = i;
								while(index != ',' || index != '}' || index != '&'){
									index++;
								}

								sparql_query_orderBy += "ASC[?" + query.substring(i+1, index) + "]";
								i = index;

							}else if(query.charAt(i) === '-'){
								index = i;
								while(index != ',' || index != '}' || index != '&'){
									index++;
								}

								sparql_query_orderBy += "DESC[?" + query.substring(i+1, index) + "] ";
								i = index;

							}else{
								if(query.charAt(i) === '{'){
									index = i+1;
								}

								if(query.charAt(i) === ','){
									sparql_orderBy += "?"+query.substring(index, i)+" ";
									index = i;
								}
							}

						}
					}

					console.log(sparql_query_prefix + sparql_query_select + sparql_query_where + sparql_query_orderBy);
					console.log(encodeURIComponent(sparql_query_prefix + sparql_query_select + sparql_query_where + sparql_query_orderBy));

					ldpService.db.query(encodeURIComponent(sparql_query_prefix + sparql_query_select + sparql_query_where + sparql_query_orderBy), "application/ld+json", function(err, ires){

						console.log(ires.body);
						console.log(typeof ires.body);
						res.sendStatus(200);

					});

			});

		}else{
			next();
		}

	});

	resource.put(function(req, res, next) {
		console.log('OSLC PUT request on:'+req.path);
		//console.log(req);
		check(req, res, function(result){
			if(result[0]){
				res.sendStatus('500');
			}else if(result[1].length > 0){
				console.log("Not correct format for the inputted resource");
				res.sendStatus('400');
			}
			console.log("EXECUTED9");
			next();
			
		});
		
	});

	resource.delete(function(req, res, next) {
		console.log('OSLC DELETE request on:'+req.path);
		next();
	});

	function getProperties(file_name){

		var file = JSON.parse(fs.readFileSync("./oslc-service/shape-files/"+file_name+"-shape.json", 'utf8'));
		var shape = file;
		console.log("SHAPE READ");
		var properties = [];

		for(var i = 0; i < shape["@graph"].length; i++){
		
			if(shape["@graph"][i]["@id"] === oslc.Property){
				properties.add(shape["@graph"][i]["name"]);			
			} 
		}

		return properties;

	}

	function verifyShape(shape_info, content, req){

		var shape = shape_info["@graph"];
		var errors = [];
		// var base_uri_shape = "https://tools.oasis-open.org/version-control/svn/oslc-core/trunk/specs/shapes/";

		// base_uri_shape+shape+"-shape.ttl#dcterms-title"

		// Every time return false is written that means append problem to a list

		console.log(content);
		for(var i = 0; i < shape.length; i++){
			console.log(shape[i]["@id"]);
			console.log(shape[i]["@type"]);

			var resource_type_found = false;

			if(shape[i]["@type"] === "oslc:ResourceShape"){
				for(var j = 0; j < content.length; j++){
					if(content[j].predicate === oslc.Type){
						if(content[j].object === shape[i]["describes"]){
							resource_type_found = true;
						}
					}
				}

				if(!resource_type_found){
					errors.push(shape[i]["name"]+ " describes is " + shape[i]["describes"]);
				}
			}

			if(shape[i]["@type"] === "oslc:Property"){
				console.log("EXECUTED 10");
				var found = false;
				for(var k = 0; k < content.length; k++){
					
					if(content[k].predicate === oslc.oslc+shape[i]["name"] || content[k].predicate === "http://purl.org/dc/terms/"+shape[i]["name"]){
						found = true;
						var expression = new RegExp("(^(http|https)://www.)(\\w+).(\\w+$)");

						if(shape[i]["oslc:readOnly"]){
							if(shape[i]["oslc:readOnly"] == true && (req.method === "PUT" || req.method === "PATCH")){
								errors.push(shape[i]["name"] + ": readOnly is " + shape[i]["oslc:readOnly"]);
							}
						}

						if(shape[i]["occurs"]){

							if(shape[i]["occurs"] === "oslc:Zero-or-one" || shape[i]["occurs"] === "oslc:Exactly-one"){
								//console.log("THIS IS WRONG 2");
								for(var z = k+1; z < content.length; z++){
									console.log(z + " " + oslc.oslc+shape[i]["name"]);
									if(content[z].predicate === oslc.oslc+shape[i]["name"]){
										errors.push(shape[i]["name"] + ": occurs is " + shape[i]["occurs"]);
										break;
									}
								}
							}

						}
						

						if(shape[i]["valueType"]){

							for(var z = k; z < content.length; z++){

								if(content[z].predicate === oslc.oslc+shape[i]["name"]){
									
									if((!shape[i]["valueType"].includes(typeof content[z].object)) && (!expression.test(content[z].object) && shape[i]["valueType"] === oslc.Resource) && (!expression.test(content[z].object) && shape[i]["valueType"] === oslc.LocalResource)){
										errors.push(shape[i]["name"] + ": valueType is " + shape[i]["valueType"]);
									}
								}
							}
						}

						if(shape[i]["maxSize"]){

							for(var z = k+1; z < content.length; z++){

								if(content[z].predicate === oslc.oslc+shape[i]["name"]){
									
									if(typeof content[z].object === 'string'){
										if(expression.test(content[z].object)){
											continue;
										}else if(content[z].object.length > shape[i]["maxSize"]){
											errors.push(shape[i]["name"] + ": maxSize is " + shape[i]["maxSize"]);
										}
										
									}else{
										if(content[z].object > shape[i]["maxSize"]){
											errors.push(shape[i]["name"] + ": maxSize is " + shape[i]["maxSize"]);
										}
									}

								}
							}
						}

						if(shape[i]["representation"]){

							for(var z = k; z < content.length; z++){

								if(content[z].predicate === oslc.oslc+shape[i]["name"]){
									if(content[z].object.includes("_b") && shape[i]["representation"] === oslc.Reference){
										errors.push(shape[i]["name"] + ": representation is " + shape[i]["representation"]);
									}else if(!express.test(content[z].object) && shape[i]["representation"] === oslc.Reference){
										errors.push(shape[i]["name"] + ": representation is " + shape[i]["representation"]);
									}else if(content[z].object.includes("_b") && shape[i]["representation"] === oslc.Inline){
										var blank_node_triple = getBlankTripleType(content, content[z].object);

										if(blank_node_triple.object !== oslc.oslc+shape[i]["range"]){
											errors.push(shape[i]["name"] + ": range is" + shape[i]["range"]);
										}
									}
								}
							}
						}

					}

				}
				

			if(!found){
				if(shape[i]["occurs"] === "oslc:Exactly-one" || shape[i]["occurs"] === "oslc:One-or-many"){
					//console.log("THIS IS WRONG 1");
					errors.push(shape[i]["name"] + ": occurs is " + shape[i]["occurs"]);
				}
			}

				
			}

		}

		return errors;

	}

	function check(req, res, callback){
		content = {};
		content.rawBody = JSON.stringify(req.body);
		
		var index = 0;

		var parse, serialize;

		if(env.contentType === 'JSON'){
			parse = json.parse;
		}else{
			parse = turtle.parse;
		}

		parse(content, '', function(err, triples){
			
			if(err){
				console.log(err.stackCode);
				callback([err, false]);
			}
			var errors_to_report = new Array();

			var file = JSON.parse(fs.readFileSync("../oslc-service/shape-files/"+req.originalUrl+".json", 'utf8'));
				
			if(file){
				errors_to_report = verifyShape(file, triples, req);
				console.log("Errors: " + errors_to_report + " " + errors_to_report.length);
				if(errors_to_report.length > 0){
					callback([null, errors_to_report]);
					return;
				}

			}
			
			callback([null, true]);

		});

	}

	// generate an ETag for a response using an MD5 hash
	// note: insert any calculated triples before calling getETag()
	function getETag(content) {
		return 'W/"' + crypto.createHash('md5').update(content).digest('hex') + '"';
	}

	// add common headers to all responses
	function addHeaders(res, document) {
		var allow = 'GET,HEAD,DELETE,OPTIONS';
		if (isContainer(document)) {
			res.links({
				type: document.interactionModel
			});
			allow += ',POST';
			res.set('Accept-Post', media.turtle + ',' + media.jsonld + ',' + media.json);
		} else {
			allow += ',PUT';
		}

		res.set('Allow', allow);
	}

	// append 'path' to the end of a uri
	// - any query or hash in the uri is removed
	// - any special characters like / and ? in 'path' are replaced
	function addPath(uri, path) {
		uri = uri.split("?")[0].split("#")[0];
		if (uri.substr(-1) !== '/') {
			uri += '/';
		}

		// remove special characters from the string (e.g., '/', '..', '?')
		var lastSegment = path.replace(/[^\w\s\-_]/gi, '');
		return uri + encodeURIComponentComponent(lastSegment);
	}

	// after the OSLC service, route requests to the LDP service
	var routes = ldpService(env);
	subApp.use(routes);
	console.log("OSLC Set-Up Complete");
	return subApp;

}
/*
// reserves a unique URI for a new subApp. will use slug if available,
// but falls back to the usual naming scheme if slug is already used
function assignURI(container, slug, callback) {
	if (slug) {
		var candidate = addPath(container, slug);
		ldpService.db.reserveURI(candidate, function(err) {
			if (err) {
				uniqueURI(container, callback);
			} else {
				callback(null, candidate);
			}
		});
	} else {
		uniqueURI(container, callback);
	}
}
*/
function getBlankTripleType(content, blank_node){
	for(var i = 0; i < content.length; i++){
		if(content[i].subject === blank_node && content[i].predicate === oslc.Type){
			return content[i];
		}
	}

	return null;
}

/*
// append 'path' to the end of a uri
// - any query or hash in the uri is removed
// - any special characters like / and ? in 'path' are replaced
function addPath(uri, path) {
	uri = uri.split("?")[0].split("#")[0];
	if (uri.substr(-1) !== '/') {
		uri += '/';
	}

	// remove special characters from the string (e.g., '/', '..', '?')
	var lastSegment = path.replace(/[^\w\s\-_]/gi, '');
	return uri + encodeURIComponentComponent(lastSegment);
}

// generates and reserves a unique URI with base URI 'container'
function uniqueURI(container, callback) {
	var candidate = addPath(container, 'res' + Date.now());
	ldpService.db.reserveURI(candidate, function(err) {
		callback(err, candidate);
	});
}
*/

module.exports = function(env) {
	return oslcRoutes(env);
}