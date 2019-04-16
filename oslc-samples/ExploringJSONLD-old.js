// See: 1.1 Using RDF in JavaScript and Node.js

// This program explores different, possibly layered approaches
// for using RDF in JavaScript and more specifically Node.js
// apps. 
//
// The resouce we'll use is the RTC ServiceProvider resource
// to be sure there are no issues parsing and manipulating
// an OSLC2 resource.

// The first step is to be able to access stdin, local file, and 
// remote resources
// request needs:
// 1. enable cookies
// 2. strictSSL: false
var fs = require('fs');
var request = require('request').defaults({
	headers: {
		'Accept': 'application/rdf+xml',
		'OSLC-Core-Version': '2.0'
	},
	strictSSL: false,
	jar: true,
	followAllRedirects: true
});
//require('request-debug')(request);

var jsonld = require('jsonld');

// The next step is to be able to parse RDF/XML, Turtle, N3 and/or
// JSON-LD resource formats. Turtle and JSON-LD are required for
// LDP. RDF/XML is required for OSLC2. N3 is in common use and 
// can be useful for debugging.
// jsonld needs:
// 

// try parsing with rdf-ext
// This doesn't work, the parsed results are not the json RDF dataset format

var rdf = require('rdf-ext')();

// Create the parsers using rdf-ext
var rdfXmlParser = function(input, callback) {
	var parser = new rdf.RdfXmlParser();
	parser.parse(input, function doneParsing(dataset) {
		console.log(dataset.toArray());
		callback(undefined, {'graph': dataset.toArray()});
	});
}
var turtleParser = function(input, callback) {
	var parser = new rdf.TurtleParser();
	parser.parse(input, function doneParsing(dataset) {
		callback(undefined, dataset.toArray());
	});
}
var jsonldParser = function(input, callback) {
	var parser = new rdf.JsonLdParser();
	parser.parse(input, function doneParsing(dataset) {
		callback(undefined, dataset.toArray());
	});
}

// Register the parsers
jsonld.registerRDFParser('application/rdf+xml', rdfXmlParser);
jsonld.registerRDFParser('text/turtle', turtleParser);
jsonld.registerRDFParser('application/ld+json', jsonldParser);

// Trying rdfi
var rdfi = require('rdf-interfaces');

// Read the RDF ServiceProviderCatalog files in the three formats
var catalogURI = 'https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog';
var rs_xml = fs.readFileSync('/Users/jamsden/Developer/oslc/spc.xml');
var rs_ttl = fs.readFileSync('/Users/jamsden/Developer/oslc/spc.ttl');
var rs_json = fs.readFileSync('/Users/jamsden/Developer/oslc/spc.json');

jsonld.fromRDF(rs_xml.toString(), {format: 'application/rdf+xml'}, function loadRDFXML(err, doc) {
	if (err) return console.log('Unable to parse RDF/XML: '+err);
	console.log('\nService Providers (from RDF/XML using jsonld):');
	console.log(doc);
	for (i=0; i<doc.length; i++) {
		console.log(doc[i]['@id']+': '+doc[i]['@graph']);
	}
	return;
});


jsonld.fromRDF(rs_ttl.toString(), {format: 'text/turtle'}, function loadTurtle(err, doc) {
	if (err) return console.log(err);
	console.log('\nService Providers (from Turtle using jsonld):');
	return;
});

// Bug: JSONLD is returning an empty dataset from the parser
jsonld.fromRDF(rs_json.toString(), {format: 'application/ld+json'}, function loadJSON(err, doc) {
	if (err) return console.log(err);
	console.log('\nService Providers (from JSON-LD using jsonld):');
	return;
});


// Let's start by exploring using JSON-LD for manipulating and querying RDF resources.
// We won't worry about parsing all the different RDF resource formats right now. Let's
// understand the value of JSON-LD for use with OSLC before worrying about the parsing
// details. So for now, we'll just use file formats that are natively supported by
// jsonld.



// Do more comples, nested queries


