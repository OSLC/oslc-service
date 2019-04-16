// See: 1.1 Using RDF in JavaScript and Node.js

// This program explores different, possibly layered approaches
// for using RDF in JavaScript and more specifically Node.js
// apps. 
//
// The resouce we'll use is the RTC ServiceProvider resource
// to be sure there are no issues parsing and manipulating
// an OSLC2 resource.
// This example explores jsonld.js for reading, parsing, accessing and updating
// JSON-LD files.

// The first step is to be able to access stdin, local file, and 
// remote resources
// request needs:
// 1. enable cookies
// 2. strictSSL: false
// For this example, just use the file system on captured fils in different formats

var async = require('async');
var fs = require('fs');
var jsonld = require('jsonld');
var sift = require('sift');

// The next step is to be able to parse RDF/XML, Turtle, N3 and/or
// JSON-LD resource formats. Turtle and JSON-LD are required for
// LDP. RDF/XML is required for OSLC2. N3 is in common use and 
// can be useful for debugging.

// Read the RDF ServiceProviderCatalog file
// jsonld.js only supports application/nquads

var catalogURI = 'https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog';

// jsonld can only parse application.nquads,

// This context was copied from the spc.json file, which was created from the RDF/XML
// file using http://rdfvalidator.mybluemix.net/. This could be constructed from the 
// ResourceShapes for an OSLC domain.
var context = {
    "serviceProvider" : {
      "@id" : "http://open-services.net/ns/core#serviceProvider",
      "@type" : "@id"
    },
    "domain" : {
      "@id" : "http://open-services.net/ns/core#domain",
      "@type" : "@id"
    },
    "publisher" : {
      "@id" : "http://purl.org/dc/terms/publisher",
      "@type" : "@id"
    },
    "title" : {
      "@id" : "http://purl.org/dc/terms/title",
      "@type" : "http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral"
    },
    "consumerRegistry" : {
      "@id" : "http://jazz.net/xmlns/prod/jazz/process/1.0/consumerRegistry",
      "@type" : "@id"
    },
    "globalConfigurationAware" : {
      "@id" : "http://jazz.net/xmlns/prod/jazz/process/1.0/globalConfigurationAware",
      "@type" : "http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral"
    },
    "supportContributionsToLinkIndexProvider" : {
      "@id" : "http://jazz.net/xmlns/prod/jazz/process/1.0/supportContributionsToLinkIndexProvider",
      "@type" : "http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral"
    },
    "supportLinkDiscoveryViaLinkIndexProvider" : {
      "@id" : "http://jazz.net/xmlns/prod/jazz/process/1.0/supportLinkDiscoveryViaLinkIndexProvider",
      "@type" : "http://www.w3.org/1999/02/22-rdf-syntax-ns#XMLLiteral"
    },
    "details" : {
      "@id" : "http://open-services.net/ns/core#details",
      "@type" : "@id"
    },
    "icon" : {
      "@id" : "http://open-services.net/ns/core#icon",
      "@type" : "@id"
    },
    "identifier" : "http://purl.org/dc/terms/identifier",
    "oslc" : "http://open-services.net/ns/core#",
    "rdf" : "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "jfs_proc" : "http://jazz.net/xmlns/prod/jazz/process/1.0/",
    "dcterms" : "http://purl.org/dc/terms/"
  }

var catalog; // for use in with sift.js in the next function

async.series([
  // Try using jsonld.js to read and write JSON-LD source (which is just JSON source)
  function readJSON(callback) {
    var spc = JSON.parse(fs.readFileSync('/Users/jamsden/Developer/oslc/spc.json'));

    // the stored .json file is actually already compacted, so it needs to be
    // expanded and re-compacted using our desired context
    jsonld.expand(spc, {}, function(err, expanded) {
      jsonld.compact(spc, context, {}, function(err, compacted) {
        if (err) return console.log("Can't compact JSON");
        console.log("Compacted JSON-LD read from JSON file:");
        console.log(JSON.stringify(compacted, null, 2));
        // get the service provider for JKE Banking (Change Management)
        // start by getting the service provider catalog
        var graph = compacted['@graph'];
        // find the ServiceProviderCatalog object
        var spc = null;
        for (o in graph) {
          if (graph[o]['@id'] === 'https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog') {
            spc = graph[o];
            break;
          }
        }
        console.log("ServiceProviderCatalog: "+spc.title);
        callback(null, null);
      });
    });
  },

  // Read and process an RDF resource (N3 in this case)
  function readRDF(callback) {
    spc = fs.readFileSync('/Users/jamsden/Developer/oslc/spc.n3');

    jsonld.fromRDF(spc.toString(), {format: 'application/nquads'}, function loadN3(err, doc) {
      if (err) return console.log('Unable to parse N3: '+err);

      // frame the JSON-LD into the format we want (flatten could be used for a canonical format)
      jsonld.frame(doc, {base: 'https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog',
          embed: '@last'
        }, function(err, framed) {

        console.log('\n\nCompacted, Framed Service Providers (from N3 using jsonld):');
        jsonld.compact(framed, context, function(err, compacted) {
          console.log(JSON.stringify(compacted, null, 2));

          // get the service provider for JKE Banking (Change Management)
          // start by getting the service provider catalog
          var graph = compacted['@graph'];
          // find the ServiceProviderCatalog object
          var spc = null;
          for (o in graph) {
            if (graph[o]['@id'] === 'https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog') {
              spc = graph[o];
              break;
            }
          }

          // get the servier provider named JKE Banking (Change Management)
          var jkesp = null;
          for (spuri in spc.serviceProvider) {
            for (o in graph) {
              var sp = graph[o];
              if (sp.title === 'JKE Banking (Change Management)') {
                jkesp = sp;
                break;
              }
            }
          }
          console.log(jkesp.title+': '+jkesp['@id']);
          catalog = compacted; // reuse this for sift.js - the framed, compacted form
          callback(null, spc);
        });
      });
    });
  },

  // do a typical ServiceProviderCatalog query using sift.js
  function queryWithSift(callback) {
    // spc is the loaded RDF as framed and compacted JSON-LD
    // The framing used embed: @last to construct a shape and structure
    // that mimics the OSLC Inlined resource shape constraint.
    // We also know there is only one graph and it contains an
    // array of deeply nested JSON objects
    var SPC = catalog["@graph"];

    // the the service provider for JKE Banking (Change Management)
    // search the service provider catalog to get the matching service provider
    console.log(SPC);
    var jkesp = sift({
      title: "JKE Banking (Change Management)"
    }, sift({
        "@type": "oslc:ServiceProviderCatalog"
    }, SPC)[0].serviceProvider);
    console.log("\n\nJKE Banking Service Provider Catalog found by sifting the SPC:");
    console.log(jkesp[0].title+":\n"+jkesp[0]);
    callback(null, null);
  }
]);


// Explore using JSON-LD for manipulating and querying RDF resources to
// understand the value of JSON-LD for use with OSLC.

// For the ServiceProviderCatalog, create a JSON-LD context


// Do more comples, nested queries


