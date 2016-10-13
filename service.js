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
	var resource = subApp.route(env.context);

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

	resource.post(function(req, res, next) {
		console.log('OSLC POST request on:'+req.path);
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

	resource.get(function(req, res, next) {
		console.log('OSLC GET request on:'+req.path);
		next();
	});

	resource.put(function(req, res, next) {
		console.log('OSLC PUT request on:'+req.path);
		//console.log(req);
		check(req, res, function(result){
			console.log("HERE " + result);
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

		var file = JSON.parse(fs.readFileSync("./shape-files/"+file_name+"-shape.js", 'utf8'));
		var shape = file;

		var properties = [];

		for(var i = 0; i < shape["@graph"].length; i++){
		
			if(shape["@graph"][i]["@id"] === oslc.Property){
				properties.add(
					shape["@graph"][i]["name"]
				);			
			}
		}

		return properties;

	}

	function verifyShape(shape, content, req){
		
		var file = JSON.parse(fs.readFileSync("../oslc-service/shape-files/"+shape+"-shape.json", 'utf8'));
		var shape_info = file;
		var shape = shape_info["@graph"];
		var errors = [];
		// var base_uri_shape = "https://tools.oasis-open.org/version-control/svn/oslc-core/trunk/specs/shapes/";

		// base_uri_shape+shape+"-shape.ttl#dcterms-title"

		// Every time return false is written that means append problem to a list

		console.log(content);
		for(var i = 0; i < shape.length; i++){
			console.log(shape[i]["@id"]);
			console.log(shape[i]["@type"]);
			if(shape[i]["@type"] === "oslc:Property"){
				console.log("EXECUTED 10");
				var j = i;
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
		console.log("EXECUTED");
		
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
				
			if(content.rawBody.includes('oslc:QueryCapability')){
				errors_to_report = verifyShape('QueryCapability', triples, req);
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
		return uri + encodeURIComponent(lastSegment);
	}

	// after the OSLC service, route requests to the LDP service
	var routes = ldpService(env);
	subApp.use(routes);
	return subApp;

}

/*

function findBlankNodes(blank_subject, triples, serialize){
    var new_triples = [];

    assignURI(blank_subject, function(err, uri){

	     var obj = "";
	     for(var i = 0; i < triples.length; i++){

	          if(triples[i].object === blank_subject){
	               break;
	          }

	          if(triples[i].subject === blank_subject){

		          if(triples[i].object.includes("_:b")){
		               obj = findBlankNodes(triples[i].subject, triples);
		          }else{
		               obj = triples[i].object;
		          }
	               
	              new_triples.push({subject: blank_subject, predicate: triples[i].predicate, object: obj});
	          }

	     }

	     serialize(new_triples, function(err, result){

	        if(err){
	        	console.log(err.stack);
	            return;
	        }

	        ldpService.db.put(uri, new_triples, function(err){
	      		if(err){
	          		console.log(err.stack);
	              	return;
	           	}

	           	return uri;
	        });        

	     });
	 });
     
}

*/


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

function getBlankTripleType(content, blank_node){
	for(var i = 0; i < content.length; i++){
		if(content[i].subject === blank_node && content[i].predicate === oslc.Type){
			return content[i];
		}
	}

	return null;
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
	return uri + encodeURIComponent(lastSegment);
}

// generates and reserves a unique URI with base URI 'container'
function uniqueURI(container, callback) {
	var candidate = addPath(container, 'res' + Date.now());
	ldpService.db.reserveURI(candidate, function(err) {
		callback(err, candidate);
	});
}


module.exports = function(env) {
	return oslcRoutes(env);
}

/*
			case content.includes('ServiceProvider'):
				index = content.indexOf('ServiceProvider');
				if(!content.includes('service', index+1)){
					res.sendStatus(406);
					return;
				}

				if(content.includes('oauthConfiguration')){
					index = content.indexOf('oauthConfiguration');
					if(content.includes('oauthconfiguration', index+1)){
						res.sendStatus(406);
						return;
					}
				}
				break;

			case content.includes('Service'):

				while(content.includes('Service', index-1)){

					var index = content.indexOf('Service');

					var index2 = content.indexOf('Service', index);

					var service = content.substring(index, index2);
					// index = content.indexOf('Service');
					if(!service.includes('domain', index+1)){
						res.sendStatus(406);
						return;
					}
					index+=2; // Arbitrary, designed so that the code looks for another instance of Service
				};
				break;

			case content.includes('CreationFactory'):
				index = content.indexOf('CreationFactory');
				if(content.includes('label', index+1)){
					var index = content.indexOf('label');
					if(content.includes('label', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				if(!content.includes('creation', index+1)){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('creation');
					if(content.includes('creation', index)){
						res.sendStatus(406);
						return;
					}
				}
				break;

			case content.includes('QueryCapability'):
				index = content.indexOf('QueryCapability');
				if(content.includes('label', index+1)){
					var index = content.indexOf('label');
					if(content.includes('label', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				if(!content.includes('queryBase')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('queryBase');
					if(content.includes('queryBase', index)){
						res.sendStatus(406);
						return;
					}
				}

				if(content.includes('resourceShape')){
					var index = content.indexOf('resourceShape');
					if(content.includes('resourceShape', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				break;

			case content.includes('Dialog'):
				if(content.includes('label')){
					var index = content.indexOf('label');
					if(content.includes('label', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				if(content.includes('hintWidth')){
					var index = content.indexOf('hintWidth');
					if(content.includes('hintWidth', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				if(content.includes('hintHeight')){
					var index = content.indexOf('hintHeight');
					if(content.includes('hintHeight', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				break;

			case content.includes('Publisher'):

				if(content.includes('label')){
					var index = content.indexOf('label');
					if(content.includes('label', index+1)){
						res.sendStatus(406);
						return;
					}
				}

				if(content.includes('icon')){
					var index = content.indexOf('icon');
					if(content.includes('icon', index+1)){
						res.sendStatus(406);
						return;
					}
				}


				if(!content.includes('identifier')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('identifier');
					if(content.includes('identifier', index)){
						res.sendStatus(406);
						return;
					}
				}

				break;

			case content.includes('PrefixDefinition'):

				if(!content.includes('identifier')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('identifier');
					if(content.includes('identifier', index)){
						res.sendStatus(406);
						return;
					}
				}

				if(!content.includes('identifier')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('identifier');
					if(content.includes('identifier', index)){
						res.sendStatus(406);
						return;
					}
				}

				break;

			case content.includes('OAuthConfiguration'):

				if(!content.includes('oauthRequestTokenURI')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('oauthRequestTokenURI');
					if(content.includes('oauthRequestTokenURI', index)){
						res.sendStatus(406);
						return;
					}
				}

				if(!content.includes('authorizationURI')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('authorizationURI');
					if(content.includes('authorizationURI', index)){
						res.sendStatus(406);
						return;
					}
				}

				if(!content.includes('oauthAccessTokenURI')){
					res.sendStatus(406);
					return;
				}else{
					var index = content.indexOf('oauthAccessTokenURI');
					if(content.includes('oauthAccessTokenURI', index)){
						res.sendStatus(406);
						return;
					}
				}

				break;

				*/

/*

case content.includes('Service'):
	
	if(!verifyShape('Service')){
		res.sendStatus('400');
	}

	break;

[
   { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#ResourceShape',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://purl.org/dc/terms/title',
       object: '"Query Capability"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"A Query Capability describes a query capability, capable of querying resources via HTTP GET or POST."',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#describes',
       object: 'http://open-services.net/ns\\core#QueryCapability',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#property',
       object: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#property',
       object: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#property',
       object: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#property',
       object: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#property',
       object: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#QueryCapability',
       predicate: 'http://open-services.net/ns/core#property',
       object: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#Property',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://open-services.net/ns/core#name',
       object: '"title"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://open-services.net/ns/core#propertyDefinition',
       object: 'http://purl.org/dc\\terms\\title',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://open-services.net/ns/core#occurs',
       object: 'http://open-services.net/ns\\core#Exactly-one',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"Title string that could be used for display"^^http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://open-services.net/ns/core#valueType',
       object: 'http://www.w3.org/1999\\02\\22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#dcterms-title',
       predicate: 'http://open-services.net/ns/core#readOnly',
       object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#Property',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://open-services.net/ns/core#name',
       object: '"label"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://open-services.net/ns/core#propertyDefinition',
       object: 'http://open-services.net/ns\\core#label',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://open-services.net/ns/core#occurs',
       object: 'http://open-services.net/ns\\core#Zero-or-one',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"Very short label for use in menu items."^^http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://open-services.net/ns/core#valueType',
       object: 'http://www.w3.org/2001\\XMLSchema#string',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-label',
       predicate: 'http://open-services.net/ns/core#readOnly',
       object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#Property',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://open-services.net/ns/core#name',
       object: '"queryBase"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://open-services.net/ns/core#propertyDefinition',
       object: 'http://open-services.net/ns\\core#queryBase',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://open-services.net/ns/core#occurs',
       object: 'http://open-services.net/ns\\core#Exactly-one',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"The base URI to use for queries. Queries are invoked via HTTP GET on a query URI formed by appending a key=value pair to the base URI, as described in Query Capabilities section."^^http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://open-services.net/ns/core#valueType',
       object: 'http://open-services.net/ns\\core#Resource',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://open-services.net/ns/core#representation',
       object: 'http://open-services.net/ns\\core#Reference',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-queryBase',
       predicate: 'http://open-services.net/ns/core#readOnly',
       object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#Property',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#name',
       object: '"resourceShape"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#propertyDefinition',
       object: 'http://open-services.net/ns\\core#resourceShape',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#range',
       object: 'http://open-services.net/ns\\core#ResourceShape',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#occurs',
       object: 'http://open-services.net/ns\\core#Zero-or-one',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"The Query Capability SHOULD provide a Resource Shape that describes the query base URI."^^http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#valueType',
       object: 'http://open-services.net/ns\\core#Resource',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#representation',
       object: 'http://open-services.net/ns\\core#Reference',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceShape',
       predicate: 'http://open-services.net/ns/core#readOnly',
       object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#Property',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#name',
       object: '"resourceType"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#propertyDefinition',
       object: 'http://open-services.net/ns\\core#resourceType',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#range',
       object: 'http://www.w3.org/2000\\01\\rdf-schema#Class',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#occurs',
       object: 'http://open-services.net/ns\\core#Zero-or-many',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"The expected resource type URI that will be returned with this query capability. These would be the URIs found in the result resource\'s rdf:type property."^^http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#valueType',
       object: 'http://open-services.net/ns\\core#Resource',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#representation',
       object: 'http://open-services.net/ns\\core#Reference',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-resourceType',
       predicate: 'http://open-services.net/ns/core#readOnly',
       object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
       object: 'http://open-services.net/ns\\core#Property',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://open-services.net/ns/core#name',
       object: '"usage"',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://open-services.net/ns/core#propertyDefinition',
       object: 'http://open-services.net/ns\\core#usage',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://open-services.net/ns/core#occurs',
       object: 'http://open-services.net/ns\\core#Zero-or-many',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://purl.org/dc/terms/description',
       object: '"An identifier URI for the domain specified usage of this query capability. If a service provides multiple query capabilities, it may designate the primary or default one that should be used with a property value of oslc:default"^^http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://open-services.net/ns/core#valueType',
       object: 'http://open-services.net/ns\\core#Resource',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://open-services.net/ns/core#representation',
       object: 'http://open-services.net/ns\\core#Reference',
       graph: '' },
     { subject: 'https://tools.oasis-open.org/version-control\\svn\\oslc-core\\trunk\\specs\\shapes\\QueryCapability-shape.ttl#oslc-usage',
       predicate: 'http://open-services.net/ns/core#readOnly',
       object: '"true"^^http://www.w3.org/2001/XMLSchema#boolean',
       graph: '' } ]


*/