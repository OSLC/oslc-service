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
var path = require("path");
var http = require('http');
var https = require('https');

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
	var ldpService = require('../ldp-service-jena'); // OSLC is built on LDP. Uses the service that incorporates Apache Jena as the DB

	var creation_dictionary = {}; // Stores the ResourceShapes associated with the Creation URI's for CreationFactories
	var query_dictionary = {};	  // Stores the ResourceShapes associated with the Query URI's for QueryCapabilities

	var link = {};
	
	var subApp = express();
	// subApp.use(rawBody);
	// anything those services don't handle will be passed to this service next
	var resource = subApp.route(env.context+'*');

	// route any requests matching the LDP context (defaults to /r/*)
	resource.all(function(req, res, next) {
		// all responses should have Link: <ldp:Resource> rel=type

		var links = {};

		for(key in link[req.originalUrl]){
			links[key] = link[req.originalUrl][key];
		}

		next();

// Looks for the compact version of the resource. When a compact version doesn't exist,
// It gives a 500 error and the code stops
/*
		ldpService.db.get(req.originalUrl+"?compact", "application/ld+json", function(err, ires){
			console.log("RESPONSE " + ires.statusCode);
			if(ires.statusCode === 200){
				links[oslc.Compact] = req.originalUrl+"?compact";
			}

			// also include implementation constraints
			res.links(links);
			
		});
*/	
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

	
	resource.post(function(req, res, next) {
		console.log('OSLC POST request on:'+req.path);

		var shape_to_get = creation_dictionary[req.originalUrl];
		
		console.log(JSON.stringify(req.body));

		// Not right... should have a shape that corresponds with a compact resource
		if(req.baseUrl.includes("?compact")){
			ldpService.db.put(req.baseUrl, req.body, "application/ld+json", function(err, ires){

				if(err){
					res.sendStatus(500);
				}

				if(ires.statusCode === 200){
					res.sendStatus(200);
				}else{
					res.sendStatus(ires.statusCode);
				}
				return;
			});
		}

		check(req, res, shape_to_get, function(result){
			console.log("HERE " + result);
			if(result.error){
				res.sendStatus('500');
			}else if(result.problems.length > 0){
				console.log("Not correct format for the inputted resource");
				res.sendStatus('400');
			}
			// console.log("EXECUTED9 " + next.stack);				

			next();
					
		});

	});

	function validResource(shape, resource){

		for(var i = 0; i < shape; i++){
			if(shape[i]["@type"] === oslc.Property){

				if(shape[i]["name"] === resource){
					return true;
				}

			}
		}

		return false;
	}

	/*

		Example queries:

		http://localhost:3000/res?oslc.where=dcterms:title="hello" and created="08-09-2014"

	*/

	function queryResource(shape, base, decode, req, res){

		console.log("QUERY");
		/*
			var query = decode.substring(decode.indexOf('?')+1, decode.length);
			var sparql_query_select = "SELECT ?g ";
			var sparql_query_where = "WHERE { GRAPH ?g { ";
			var sparql_query_prefix = "";
			var sparql_query_orderBy = "";

		*/

		// Construct SPARQL Query
		// Use resource shapes to determine that vocab used is accurate
			class Node {
	
				constructor(val, left, right){
					this.val = val;
					this.left = left;
					this.right = right;
				}

			}
				
			var query = decode.substring(decode.indexOf('?')+1, decode.length);
			var node = null;
			var oslc_node = null
			var amp_node = null
			var curl_node_stack = new Array();

			var index = 0;

			for(var i = 0; i < query.length; i++){
				
				// Does not take into account >, <, <=, >= comparators
				if(query.charAt(i) === '='){
	
					var val_one = query.substring(index, i);
					console.log("FIRST VAL " + val_one);
					if(val_one === "oslc.where" || val_one === "oslc.select" || val_one === "oslc.prefix"){

						if(amp_node){
							amp_node.right = new Node(query.charAt(i), new Node(val_one, null, null), null);
							node = amp_node.right;
						}else{
							node = new Node(query.charAt(i), new Node(val_one, null, null), null);
						}
						
						oslc_node = node;
						console.log(oslc_node);
						index = i+1;
						
					}else{

						index = i;

						while(query.charAt(index) !== '&' && query.charAt(index) !== ' ' && index < query.length){
							index++;
						}

						var val_two = query.substring(i+1, index);
						console.log("VAL TWO " + val_two);
						var tmp = new Node(query.charAt(i), new Node(val_one, null, null), new Node(val_two, null, null));

						if(query.charAt(i+val_two.length+1) === ' '){
							if(query.substring(i+val_two.length+2, i+val_two.length+5) === "and"){
							
								and_node = new Node("and", tmp, null);
								node.right = and_node;
								i += (val_two.length+5);

								node = node.right;
							}
						}else{
							node.right = tmp;
						}

						

					}			

				}

				if(query.charAt(i) === '&'){

					if(oslc_node.left.val === "oslc.select"){
						node.right = new Node(query.substring(index, i), null, null);
					}
					
					if(amp_node === null){
						left_node = oslc_node;
						console.log("LEFT NODE");
						console.log(left_node);
						node = new Node('&', left_node, null);
						amp_node = node;
					}else{
						amp_node = new Node('&', amp_node, null);
					}
					index = i+1;

				}

						// Unfinished. Does not take into account ',' within a {}
						/*
							if(query.charAt(i) === '{'){
				
								open_paran_node = new Node('{', new Node(query.substring(index, i), null, null), new Node('}', null, null));
								curl_nodes.push(open_paran_node);
								pre_curl_node = node;
								node = open_paran_node;

							}

							if(query.charAt(i) === '}'){
								
								ret_node = curl_nodes.pop();

								if(curl_nodes.length === 0){
									pre_curl_node.right = ret_node;
									node = pre_curl_node.right;
								}else{
									curl_nodes[curl_nodes.length-1].right.left = ret_node;
								}

							}
						*/



				if(query.charAt(i) === ','){
	

					var val = query.substring(index, query.charAt(i));
					comma_node = new Node(',', val, null);
					node.right = comma_node;
					node = node.right;
					index = i+1;

				}

			}
	
			if(amp_node){
				console.log("NODE");
				console.log(amp_node);
				console.log(oslc_node);
				ldpService.db.query(amp_node, function(err, ires){

					if(err){
						console.error(err.stack);
						res.sendStatus(500);
					}

				});

			}else{
				console.log("NODE");
				console.log(oslc_node);
				ldpService.db.query(oslc_node, base, function(err, ires){

					if(err){
						console.error(err.stack);
						res.sendStatus(500);
					}

				});

			}
			


		// Code below directly translated OSLC Query to SPARQL, defunct 
		// Because it only works with Apache Jena or other DB that supports SPARQL

		/*
					

		if(query.includes("oslc.prefix")){
		
			index = query.indexOf("oslc.prefix")+"oslc.prefix".length+1;

			for(var i = index; i < query.length && query.charAt(i) !== '&'; i++){

				if(query.charAt(i) === '=' || query.charAt(i) === '>' || query.charAt(i) === '<'){
					var resource = query.substring(index, i);
					index_follow = i+1;
					// check if param is valid
					// http://example.com/bugs?oslc.where=cm:severity="high" and dcterms:created>"2010-04-01"
							
					while(query.charAt(index_follow) != '&' && index_follow < query.length && query.charAt(index_follow) != ',' && query.charAt(index_follow) != '}'){
		
						index_follow++;

					}

					sparql_query_prefix+="PREFIX "+resource+": " + query.substring(i+1, index_follow)+" ";

					if(query.charAt(index_follow) === '&'){
						break;
					}
					i = index_follow;
					index = i+1;


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

					// Check shape to see if resource is valid

					//if(validResource(shape, resource)){
					sparql_query_select += "?"+resource.replace(':','_')+" ";
					sparql_query_where += stack[stack.length-1] + " " + resource + " ?" + resource.replace(':', '_') + " . ";
					index = i;
					//}else{
					//	return;
					//}
					// End check
									
					// http://localhost:3000/r/tasks?oslc.prefix%3Dcm%3D%3Chttp%3A%2F%2Fqm.example.com%2Fns%3E%2Cdcterms%3D%3Chttp%3A%2F%2Fdcterms.example.com%3E%26oslc.select%3Ddcterms%3Acreated%2Cdcterms%3Acreator%26oslc.where%3Dcm%3Aseverity%3D%22high%22

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
					resource = query.substring(index, i).replace(':','_');
					index = i;
					stack.push("?"+resource);
									
				}

				if(query.charAt(i) === '}'){

					if(stack[stack.length-1] !== "?s"){
						resource = query.substring(index, i);
						sparql_query_select += " ?"+resource;
						sparql_query_where += stack[stack.length-1] + " " + resource + " ?" + resource.replace(':','_');
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

		if(query.includes("oslc.where")){
							
			var index = query.indexOf("oslc.where")+"oslc.where=".length;
			var index_follow;
			var filters = [];
			console.log(index);
			for(var i = index; i < query.length && query.charAt(i) !== '&'; i++){

				if(query.charAt(i) === '=' || query.charAt(i) === ' ' || query.charAt(i) === '<' || query.charAt(i) === '>' || query.charAt(i) === '!'){
					console.log(query.charAt(i));
					var resource = query.substring(index, i);

					//if(validResource(shape, resource)){
					index_follow = i;
					//}else{
					//	return;
					//}
					// check if param is valid
					// http://example.com/bugs?oslc.where=cm:severity="high" and dcterms:created>"2010-04-01"
					// oslc.prefix=cm=<http://qm.example.com/ns>,dcterms=<http://dcterms.example.com>&oslc.select=dcterms:created,dcterms:creator&oslc.where=cm:severity="high"&oslc.orderBy=-dcterms:created
					// oslc.prefix%3Dcm%3D%3Chttp%3A%2F%2Fqm.example.com%2Fns%3E%2Cdcterms%3D%3Chttp%3A%2F%2Fdcterms.example.com%3E%26oslc.select%3Ddcterms%3Acreated%2Cdcterms%3Acreator%26oslc.where%3Dcm%3Aseverity%3D%22high%22%26oslc.orderBy%3D-dcterms%3Acreated

					while(query.charAt(index_follow) != '&' && index_follow < query.length && query.charAt(index_follow) != ' ' && query.charAt(index_follow) != '}'){
		
						index_follow++;

					}



					if(!sparql_query_where.includes("?s " + resource + " " + query.substring(i+1, index_follow) + " . ")){
						sparql_query_where+="?s " + resource + " " + query.substring(i+1, index_follow) + " . ";
										
					}

					/*

						if a comparison is in use other than =

						if(!sparql_query_where.includes("?s " + resource + " " + query.substring(i+1, index_follow) + " . ")){
							sparql_query_where+="?s " + resource + " " + resource.replace(':','_') + " . ";
						}
										
						filter.push(resource.replace(':','_')+query.charAt(i)+query.substring(i+1, index_follow));

					

					if(query.charAt(index_follow) === '&'){
						break;
					}

					i = index_follow;
					index = i;
				}

				if(query.charAt(i) === ' '){
					if(query.substring(i+1, i+4) === "and"){
						i+=5;
						index = i;
											
					}
				}

				if(query.charAt(i) === '{'){

					var resource = query.substring(index, i).replace(':','_');

					//if(validResource(shape, resource)){
					sparql_query_where += "?s " + resource + " ?o . ";
					// do recursion, but utnil '}' is executed, return last index
					index = i+1;
					//}else{
					//	return;
					//}
										
				}


			}

			
			if(filter.length > 0){

				sparql_query_where+="FILTER "+filter[0];

				for(var i = 1; i < filter.length; i++){
					sparql_query_where+=" && "+filter[i];
				}

			}
			

			sparql_query_where += "} } ";

							
			}

			if(query.includes("oslc.orderBy")){

				console.log("ORDER BY");

				sparql_query_orderBy += "ORDER BY ";
		
				var index = query.indexOf("oslc.orderBy")+"oslc.orderBy=".length;
				var index_follow;
				for(var i = index; i < query.length && query.charAt(i) !== '&'; i++){

					if(query.charAt(i) === '+'){

						index = i;
						while(index != ',' && index != '}' && index != '&' && index < query.length){
							index++;
						}

						sparql_query_orderBy += "ASC(?" + query.substring(i+1, index).replace(':','_') + ") ";
						i = index;

					}else if(query.charAt(i) === '-'){
									
						index = i;
						while(index != ',' && index != '}' && index != '&' && index < query.length){
							index++;
						}
									
						sparql_query_orderBy += "DESC(?" + query.substring(i+1, index).replace(':','_') + ") ";
						i = index;

					}else{
						if(query.charAt(i) === '{'){
							index = i+1;
						}

						if(query.charAt(i) === ','){
							sparql_orderBy += "?"+query.substring(index, i).replace(':','_')+" ";
							index = i;
						}

					}

				}

			}

			console.log("SPARQL FORMATION COMPLETE");
			console.log(sparql_query_prefix + sparql_query_select + sparql_query_where + sparql_query_orderBy);
			console.log(encodeURIComponent(sparql_query_prefix + sparql_query_select + sparql_query_where + sparql_query_orderBy));

			var result = function(results){
				
			}

			ldpService.db.query(encodeURIComponent(sparql_query_prefix + sparql_query_select + sparql_query_where + sparql_query_orderBy), function(err, ires){

				console.log(ires.body);
				console.log(typeof ires.body);

				if(query.includes("oslc.searchTerms") && !query.includes("oslc.select")){ // Can SELECT be used w/ SearchTerms

					var terms = {};

					var index = query.indexOf("oslc.searchTerms")+"oslc.searchTerms".length;
					var i;
					for(i = 0; i < query.length && !query.indexOf('&'); i++){
						if(query.charAt(i) === ','){
							terms[query.substring(index, i)] = 0;
							index = i;
						}
					}

					var count = 0;

					var info = JSON.parse(ires.body)["results"]["bindings"];

					// [0]["g"]["value"];

					// Figure out a good way to sort the 
					for(var j = 0; j < info.length; j++){
						ldpService.get(info[j]["uri"], "application/ld+json", function(err, result){
							for(var key in result["@graph"][0]){

								for(var term in terms){

									if(result["@graph"][key].includes(term)){
										count++;
									}

								}
												
							}

							terms[info[j]["uri"]] = count;
							count = 0;

							// sort values
							// for value
							// 		for key
							//			insert into new list that will be return

							if(j === info.length-1){

								counts.sort();

								to_return = [];

								for(var i = 0; i < counts.length; i++){
									for(var key in terms){
										if(terms[key] === counts[i]){
											to_return.push({"subject": oslc.results, "predicate": rdf.resource, "object": key}); // rdf:resource
										}
									}
								}

							}

							json.serialize(to_return, function(err, result){

								if(err){
									res.sendStatus('500');
								}

								res.body = result;
								res.sendStatus(200);
							});

						});

				}
				

			}else{

				res.body = ires.body;
							
				res.sendStatus(200);
			}

		});
		*/

	}

	var resource_uri = undefined;
	subApp.get('/ResourceInfo', function(req, res) {

		ldpService.db.get(resource_uri, "application/ld+json", function(err, ires){

			res.sendJSON(ires.body);

		});

	});

	// Used for initializing Selection Dialog
	subApp.get('/all', function(req, res){

		// Need to remove SPARQL, how to populate the Selection Dialog

		var node = Node("=", Node("oslc.select", null, null), Node("*", null, null));

		ldpService.db.query(node, "", function(err, ires){
			res.set({'Access-Control-Allow-Origin': '*'});
			res.json(ires.body);
		});

	});

	resource.get(function(req, res, next) {
		console.log('OSLC GET request on:'+req.path);
		console.log(req.originalUrl);

		// Implements UI Preview
		if(req['Accept'] === 'application/x-oslc-compact+json'){

			var compact = {};

			ldpService.db.get(req.originalUrl, "application/ld+json", function(err, ires){
				compact.title = JSON.parse(ires.body)["name"];
				compact.smallPreview = {};
				compact.largePreview = {};

				compact.smallPreview.hintWidth = "45ex";
				compact.smallPreview.hintHeight = "20ex";
				compact.document = req.baseUrl+"?preview=small";

				compact.largePreview.hintWidth = "60ex";
				compact.largePreview.hintHeight = "30ex";
				compact.document = req.baseUrl+"?preview=large";

				res.body = compact;

				// Set header to be JSON
				res.sendStatus(200);

			});

		}else if(req.originalUrl.includes("?preview=large")){

			resource_uri = req.originalUrl.substring(0, req.originalUrl.indexOf('?'));
			res.set('Content-Type', 'text/html');
			res.send(path.resolve("./preview/preview-large.html"));

		}else if(req.originalUrl.includes("?preview=small")){

			resource_uri = req.originalUrl.substring(0, req.originalUrl.indexOf('?'));
			res.set('Content-Type', 'text/html');
			res.send(path.resolve("./preview/preview-small.html"));

		}else if(req.originalUrl.includes("/selection-dialog")){
			res.set('Content-Type', 'text/html');
			res.send(path.resolve("./dialog/dialog-select.html"));

		}else if(req.originalUrl.includes("/creation-dialog")){
			console.log("CREATION");
			res.set('Content-Type', 'text/html');
			console.log(path.resolve("./dialog/dialog-create.html"));
			res.sendFile(path.resolve("./dialog/dialog-create.html")); // Sends the contents of the file, so the HTML

		}else if(req.originalUrl.includes("?")){
			var base = req.originalUrl.substring(0, req.originalUrl.indexOf('?'));
			// Need to replace '/' w/ %2F to be in compliance w/ URI
			console.log("QUERY BASE " + base);
			
			var decode = decodeURIComponent(req.originalUrl);

			file_name = query_dictionary[base];
			console.log(file_name);

			if(file_name === undefined){
				queryResource(null, base, decode, req, res);
			}else{

				ldpService.db.get(file_name, "application/ld+json", function(err, ires){

					queryResource(JSON.parse(ires.body), base, decode, req, res);

				});

			}
			
			
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

		ldpService.db.get(file_name, "application/ld+json", function(err, ires){

			var shape = ires.body;
			var properties = [];

			for(var i = 0; i < shape.length; i++){
			
				if(shape[i]["@id"] === oslc.Property){
					properties.add(shape[i]["name"]);			
				} 
			}

			return properties;

		});
		
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

			// Not checking 'describes' correctly, need to fix
			/*
			if(shape[i]["@type"] === "oslc:ResourceShape"){
				for(var j = 0; j < content.length; j++){
					console.log(content[j].predicate);
					if(content[j].predicate === oslc.Type){
						console.log("True");
						if(content[j].object === shape[i]["describes"]){
							resource_type_found = true;
						}
					}
				}

				if(!resource_type_found){
					errors.push("Describes is " + shape[i]["describes"]);
				}
			}
			*/

			if(shape[i]["@type"] === "oslc:Property"){

				var found = false;
				for(var k = 0; k < content.length; k++){
					
					if(content[k].predicate === oslc.oslc+shape[i]["name"] || content[k].predicate === "http://purl.org/dc/terms/"+shape[i]["name"]){
						found = true;
						var expression = new RegExp("(^(http|https)://www.)(\\w+).(\\w+$)");

						if(shape[i]["oslc:readOnly"]){
							if(shape[i]["oslc:readOnly"] === true && (req.method === "PUT" || req.method === "PATCH")){
								errors.push(shape[i]["name"] + ": readOnly is " + shape[i]["oslc:readOnly"]);
							}
						}

						if(shape[i]["occurs"]){

							if(shape[i]["occurs"] === "oslc:Zero-or-one" || shape[i]["occurs"] === "oslc:Exactly-one"){

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
									}else if(!expression.test(content[z].object) && shape[i]["representation"] === oslc.Reference){
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
						errors.push(shape[i]["name"] + ": occurs is " + shape[i]["occurs"]);
					}
				}

				
			}

		}

		return errors;

	}

	function check(req, res, shape_to_get, callback){
		var content = {};
		content.rawBody = JSON.stringify(req.body);
		
		var index = 0;

		var parse, serialize;

		if(env.contentType === 'JSON'){
			parse = json.parse;
		}else{
			parse = turtle.parse;
		}

		console.log(req.body);
		console.log(content.rawBody);

		parse(content, '', function(err, triples){
			
			if(err){
				console.log(err.stackCode);
				callback([err, false]);
			}

			var errors_to_report = new Array();

			//var file = JSON.parse(fs.readFileSync("../oslc-service/shape-files/"+req.originalUrl+".json", 'utf8'));
			
			ldpService.db.get(shape_to_get, "application/ld+json", function(err, ires){

				preProcessVerifyShape(JSON.parse(ires.body), triples, req, callback);

			});
			

		});

	}

	function preProcessVerifyShape(file, triples, req, callback){

		errors_to_report = verifyShape(file, triples, req);
		var results = {};
		console.log("Errors: " + errors_to_report + " " + errors_to_report.length);
		if(errors_to_report.length > 0){
			results.error = null;
			results.problems = errors_to_report;
			callback(results);
			return;
		}

		results.error = null;
		results.problems = [];
		callback(results);
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
	// var routes = ldpService(env);
	subApp.use(ldpService(env));
	console.log("OSLC Set-Up Complete");
	ldpService.db.get(env.ldpBase, 'application/ld+json', function(err, document) {
			console.log(err + " " + document.statusCode);
			if (err) {
				console.log(err.stack);
				return;
			}

			if (document.statusCode === 404) {
				createRootContainer(env, function(err) {
					if (err) {
						console.log(err.stack);
					}
				});
			}

			function createRootContainer(env, callback) {
		
				var file = fs.readFileSync(env.services, 'utf8');
				var services = JSON.parse(file);
				console.log(services);
				//readShapes(services, callback);
				var obj = {};
				obj.rawBody = file.toString();
				console.log(obj.rawBody);
				json.parse(obj, env.ldpBase, function(err, triples){
					if(err){
						callback(err);
					}
					console.log(triples);
					var mark = Date.now(); // used to identify resources
					findBlankNodes(env.ldpBase+services["@graph"][0]["@id"], env.ldpBase, triples, json.serialize, true, mark, callback);
					callback(null);
				});

			}

	function insertShape(shape_uri, callback){


		try{
			http.get(shape_uri, function(response){
				var data = "";								
				response.on('data', function(chunk){
					console.log(typeof chunk);
					data += chunk;
													
				});
				response.on('end', function(){
					console.log(typeof data);

					ldpService.db.put(shape_uri, data, "text/turtle", function(err, ires){
						console.log(err + " " + ires.statusCode);
						if(err){
							console.error(err.stack);
							callback(err);
						}
						if(ires.statusCode === 500){
							callback(err);
						}
					});
				});
											
			});
										
		}catch(err){
			console.error("Resource does not exist");
			var results = {};
			results.error = err;
			
		}


	}

	function findBlankNodes(blank_subject, main_uri, triples, serialize, first_time, mark, callback){

	    var new_triples = [];

	    var service_type = "";

	    for(var i = 0; i < triples.length; i++){

		        console.log("LOOKING FOR: " + blank_subject);
		          if(triples[i].subject === blank_subject){

			          if(triples[i].predicate === oslc.Type){
			          	   console.log("FOUND NODE: " + triples[i].object);
			               obj = findBlankNodes(triples[i].object, uri, triples, serialize, first_time, mark++, callback);
			               
			          }
		          }

		}

	    return assignURI(main_uri, "/", first_time, mark, function(err, uri, first_time){

	    	if(err){
	    		callback(err);
	    	}

		    var obj = "";
		    for(var i = 0; i < triples.length; i++){

		        console.log("LOOKING FOR: " + blank_subject);
		          if(triples[i].subject === blank_subject){

			          if(triples[i].object.includes("_:b")){
			          	   console.log("FOUND NODE: " + triples[i].object);
			               obj = findBlankNodes(triples[i].object, uri, triples, serialize, first_time, mark++, callback);
			               
			          }else if(triples[i].object.includes("ex:")){ 	// implies that there's an external file, needs to be checked
			          		var file = fs.readFileSync(triples[i].object);
							obj = findBlankNodes(triples[i].object, uri, triples, serialize, first_time, mark++, callback);
							json.parse(file, function(err, ex_triples){
								if(err){
									callback(err);
								}
								findBlankNodes(obj, uri, ex_triples, serialize, true, mark++, callback);
							});
							
			          }else{
			               obj = triples[i].object;
			          }

		              console.log("MADE TRIPLE: {subject: "+uri+", predicate: "+triples[i].predicate+", object: "+obj+"}");
		              new_triples.push({subject: uri, predicate: triples[i].predicate, object: obj});
		          }

		     }

		     new_triples.push({subject: uri, predicate: rdf.type, object: ldp.BasicContainer});

		     serialize(new_triples, function(err, content_type, result){

		        if(err){
		        	console.log(err.stack);
		            callback(err);
		        }

		        link[uri] = {};

		       	var json_result = JSON.parse(result);

		        console.log("RESULT");
		        console.log(json_result); 

		        if(json_result['@type'][0] === oslc.CreationFactory){
		        	if(json_result[oslc.resourceShape]['@id'].includes(".ttl")){

		        		insertShape(json_result[oslc.resourceShape]['@id'], callback);
			        	json_result[oslc.resourceShape]['@id']
			        	var creation_uri = json_result[oslc.creation]['@id'];
			        	console.log(result);
			        	creation_dictionary[creation_uri] = json_result[oslc.resourceShape]['@id'];
			        	link[uri]["type"] = json_result[oslc.resourceShape]['@id'];	

		        	}
		        	
		        }

		        if(json_result[oslc.selectionDialog]){
		        	link[uri][oslc.selectionDialog] = json_result[oslc.selectionDialog];
		        }

		        if(json_result[oslc.creationDialog]){
		        	link[uri][oslc.creationDialog] = json_result[oslc.creationDialog];
		        }

		        if(json_result['@type'][0] === oslc.QueryCapability){

		        	if(json_result[oslc.resourceShape]['@id'].includes(".ttl")){

		        		var query_uri = json_result[oslc.queryBase]['@id'];
			        	console.log(result);
			        	query_dictionary[query_uri] = json_result[oslc.resourceShape]['@id'];
			        	console.log(query_dictionary[query_uri]);

			        	link[uri]["type"] = json_result[oslc.resourceShape]['@id'];

		        	}
		        	
		        	
		        }

		        if(json_result['@type'][0] === oslc.Dialog){
		        	if(json_result[oslc.resourceShape]){
		        		link[uri]["type"] = json_result[oslc.resourceShape]['@id'];
		        	}
		        	
		        }

		        ldpService.db.put(uri, result, 'application/ld+json', function(err){
		      		if(err){
		          		console.log(err.stack);
		              	callback(err);
		           	}

		           	return uri;
		        });        

		     });
		 });

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
		function uniqueURI(container, first_time, mark, callback) {
			if(!first_time){
				container = addPath(container, 'res' + mark);
			}
			first_time = false;
			console.log("CANDIDATE: " + container);
			ldpService.db.reserveURI(container, function(err) {

				if(err){
					console.error("URI already in use");
					return;
				}
				console.log("CANDIDATE: " + container + " " + err);
				callback(err, container, first_time);
			});

			return container;
		}

		// reserves a unique URI for a new subApp. will use slug if available,
		// but falls back to the usual naming scheme if slug is already used
		function assignURI(container, slug, first_time, mark, callback) {
/*
			if (slug) {
				var candidate = addPath(container, slug);
				uniqueURI(candidate, callback);

				/*l
				db.reserveURI(candidate, function(err) {

					if (err) {
						uniqueURI(container, callback);
					} else {
						callback(null, candidate);
					}
				});
				
			} else {
*/	
				//console.log("CANDIDATE: " + container);
				return uniqueURI(container, first_time, mark, callback);
			//}
		}
	     
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
		});
	return subApp;

}

// creates a root container on first run
	

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