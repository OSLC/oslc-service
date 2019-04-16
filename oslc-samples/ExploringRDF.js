// See: Using RDF in JavaScript and Node.js

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


// The next step is to be able to parse RDF/XML, Turtle, N3 and/or
// JSON-LD resource formats. Turtle and JSON-LD are required for
// LDP. RDF/XML is required for OSLC2. N3 is in common use and 
// can be useful for debugging.
// rdflib needs:
// 1. npm install io
// 2. npm install xmldom
// 3. a bug in parseXML at https://github.com/ckristo/rdflib.js/tree/xmldom
var $rdf = require('rdflib');
//require('request-debug')(request);

// Some useful namespaces
var FOAF = $rdf.Namespace("http://xmlns.com/foaf/0.1/");
var RDF = $rdf.Namespace("http://www.w3.org/1999/02/22-rdf-syntax-ns#");
var RDFS = $rdf.Namespace("http://www.w3.org/2000/01/rdf-schema#");
var OWL = $rdf.Namespace("http://www.w3.org/2002/07/owl#");
var DC = $rdf.Namespace("http://purl.org/dc/elements/1.1/");
var RSS = $rdf.Namespace("http://purl.org/rss/1.0/");
var XSD = $rdf.Namespace("http://www.w3.org/TR/2004/REC-xmlschema-2-20041028/#dt-");
var CONTACT = $rdf.Namespace("http://www.w3.org/2000/10/swap/pim/contact#");
var OSLC = $rdf.Namespace("http://open-services.net/ns/core#");
var OSLCCM = $rdf.Namespace('http://open-services.net/ns/cm#');
var DCTERMS = $rdf.Namespace('http://purl.org/dc/terms/');
var OSLCCM10 = $rdf.Namespace('http://open-services.net/xmlns/cm/1.0/');

// Create a different KB for each resource, treating them as separate graphs
var kb_xml = new $rdf.IndexedFormula();
var kb_ttl = new $rdf.IndexedFormula();
var kb_json = new $rdf.IndexedFormula();

// Read the ServiceProviderCatalog file using different content types
// This tests the different parsers: Turtle, JSON-LD and RDF/XML
var catalogURI = 'https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog';
var rs_xml = fs.readFileSync('/Users/jamsden/Developer/oslc-samples/spc.xml');
var rs_ttl = fs.readFileSync('/Users/jamsden/Developer/oslc-samples/spc.ttl');
var rs_json = fs.readFileSync('/Users/jamsden/Developer/oslc-samples/spc.json');

$rdf.parse(rs_xml.toString(), kb_xml, catalogURI, 'application/rdf+xml');
$rdf.parse(rs_ttl.toString(), kb_ttl, catalogURI, 'text/turtle');

// JSON-LD is supported, but only parsed asynchronously

// Parse JSON-LD and print the discovered service providers
$rdf.parse(rs_json.toString(), kb_json, catalogURI, 'application/ld+json', function(err, kb) {
    if (err) return console.log('Unable to parse JSON-LD: '+err);
	console.log('\nService Providers (from JSON-LD):')
	var serviceProviders = kb_json.each(kb_json.sym(catalogURI), OSLC('serviceProvider'));
	for (sp in serviceProviders) {
		var title = kb_json.the(serviceProviders[sp], DCTERMS('title'));
		console.log(title.value.toString()+': '+serviceProviders[sp].uri);
	}
});

// Next, query the in-memory RDF dataset
// Get primitive values, individuals and collections

// Get the CM ServiceProviders
// Bug: Doesn't parse RDF/XML correctly:
// <dcterms:title rdf:parseType="Literal">IBM Rational Team Concert Work Items</dcterms:title>
// title.value.toString() is '<dcterms:title rdf:parseType="Literal">JKE Banking (Change Management)</dcterms:title>'
// and should be 'JKE Banking (Change Management)' - a string containing the (unparsed) XML content, no DOM
console.log('\nService Providers (from RDF/XML):')
var serviceProviders = kb_xml.each(kb_xml.sym(catalogURI), OSLC('serviceProvider'));
for (sp in serviceProviders) {
	var title = kb_xml.the(serviceProviders[sp], DCTERMS('title'));
	console.log(title.value.toString()+': '+serviceProviders[sp].uri);
}


// The Turtle is parsed correctly
// dcterms:title "JKE Banking (Change Management)"^^rdf:XMLLiteral .
// title.value.toString() is a string containing the (unparsed) XML content
console.log('\nService Providers (from Turtle):')
var serviceProviders = kb_ttl.each(kb_ttl.sym(catalogURI), OSLC('serviceProvider'));
for (sp in serviceProviders) {
	var title = kb_ttl.the(serviceProviders[sp], DCTERMS('title'));
	console.log(title.value.toString()+': '+serviceProviders[sp].uri);
}

// Same query using statementsMatching, this returns [statements],
// {subject, predicate, object}, not objects
console.log('\nService Providers (using statementsMatching()):')
var serviceProviders = kb_ttl.statementsMatching(kb_ttl.sym(catalogURI), OSLC('serviceProvider'), undefined);
for (sp in serviceProviders) {
	var title = kb_ttl.the(serviceProviders[sp].object, DCTERMS('title'));
	console.log(title.value.toString()+': '+serviceProviders[sp].object.uri);
}

// Next do more complex, nested SPARQL-like queries

// Get all services provides with a given title
// Create the variables for the query
var sp = $rdf.variable('sp');
var title = $rdf.variable('title');

// Create the query with a name and id (for tracking)
var allServiceProviders = new $rdf.Query('allServiceProviders', 1);
// Add the query patterns - subject, predicate, object like SPARQL
allServiceProviders.pat.add(kb_ttl.sym(catalogURI), OSLC('serviceProvider'), sp);
allServiceProviders.pat.add(sp, DCTERMS('title'), title);

// kb.query(queryPattern, matchCallback(results), undefined(unused), onDoneCallback)
console.log('\nService Providers (from a query):')
kb_ttl.query(allServiceProviders, function logServiceProvider(results) {
	console.log('Query result: '+results['?title'].value+': '+results['?sp'].uri);
}, undefined, undefined);

// Now do a query that matches against a literal value
// Get the ServiceProvider URI for the JKE Banking (Change Management) Project Area
var xmlLitSym = kb_ttl.sym('http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral');

var jkesp = new $rdf.Query('jkesp', 2);
jkesp.pat.add(kb_ttl.sym(catalogURI), OSLC('serviceProvider'), sp);
jkesp.pat.add(sp, DCTERMS('title'), kb_ttl.literal('JKE Banking (Change Management)', undefined, xmlLitSym));

// query(queryPattern, matchCallback(results), undefined(unused), onDoneCallback)
console.log('\nJKE Banking (Change Management) ServiceProvider: (from a single query)')
kb_ttl.query(jkesp, function getJKESP(results) {
	console.log('JKE Banking (Change Management): '+results['?sp'].uri);
}, undefined, undefined);

