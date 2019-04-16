sift = require('sift');



var people = [
  {
    "firstName": "John",
    "lastName": "Smith",
    "gender": "man",
    "age": 32,
    "address": {
        "streetAddress": "21 2nd Street",
        "city": "New York",
        "state": "NY",
        "postalCode": "10021"
    },
    "phoneNumbers": [
        { "type": "home", "number": "212 555-1234" },
        { "type": "fax", "number": "646 555-4567" }
    ]
  }, {
    "firstName": "Fred",
    "lastName": "Johnson",
    "gender": "man",
    "age": 33,
    "address": {
        "streetAddress": "62 Michael Road",
        "city": "North Attleboro",
        "state": "NY",
        "postalCode": "40375"
    },
    "phoneNumbers": [
        { "type": "home", "number": "207-472-5956" },
        { "type": "fax", "number": "646 555-3866" }
    ]
  }, {
    "firstName": "Jane",
    "lastName": "Doe",
    "gender": "woman",
    "age": 28,
    "address": {
        "streetAddress": "Green Ridge Road",
        "city": "Fort Fairfield",
        "state": "ME",
        "postalCode": "04401"
    },
    "phoneNumbers": [
        { "type": "home", "number": "207-472-5957" },
        { "type": "fax", "number": "646 555-6732" }
    ]
 }, {
    "firstName": "Kathy",
    "lastName": "Smith",
    "gender": "woman",
    "age": 34,
    "address": {
        "streetAddress": "Green Ridge Road",
        "city": "Fort Fairfield",
        "state": "ME",
        "postalCode": "04401"
    },
    "phoneNumbers": [
        { "type": "home", "number": "207-472-5957" },
        { "type": "fax", "number": "646 555-6732" }
    ] 	
 }
];


console.log("All People")
console.log(sift({}, people));

console.log("\n\nPeople older than 30");
console.log(sift({age: {$gt: 30}}, people));

console.log("\n\nPeople older than 30 living in NY");
console.log(sift({
	age: {$gt: 30},
	address: {state: "NY"} // $eq is the default
}, people));

console.log("\n\nPeople older than 30 living in NY with a particular home phone number of 207-472-5956");
console.log(JSON.stringify(sift({
	age: {$gt: 30},
	address: {state: "NY"},
	phoneNumbers: 
		{type: "home", number: {$regex: /^207/}}
	
}, people), null, 5));

var spc = [{
	"@id" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/workitems/catalog",
    "@type" : "oslc:ServiceProviderCatalog",
    "domain" : "http://open-services.net/ns/cm#",
    "serviceProvider" : [ 
		{
		    "@id" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/contexts/_SSJ_4P8DEeSQtPcnT3mjXQ/workitems/services.xml",
		    "@type" : "oslc:ServiceProvider",
		    "consumerRegistry" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/process/project-areas/_SSJ_4P8DEeSQtPcnT3mjXQ/links",
		    "globalConfigurationAware" : "compatible",
		    "supportContributionsToLinkIndexProvider" : "true",
		    "supportLinkDiscoveryViaLinkIndexProvider" : "false",
		    "details" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/process/project-areas/_SSJ_4P8DEeSQtPcnT3mjXQ",
		    "title" : "RELM Basic (Change Management)"
		}, {
		    "@id" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/contexts/_XTHEEBjoEeWcNJtNeNtMmg/workitems/services.xml",
		    "@type" : "oslc:ServiceProvider",
		    "consumerRegistry" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/process/project-areas/_XTHEEBjoEeWcNJtNeNtMmg/links",
		    "globalConfigurationAware" : "compatible",
		    "supportContributionsToLinkIndexProvider" : "true",
		    "supportLinkDiscoveryViaLinkIndexProvider" : "false",
		    "details" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/process/project-areas/_XTHEEBjoEeWcNJtNeNtMmg",
		    "title" : "JUnit Project"
		}, {
		    "@id" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/oslc/contexts/_pMhMgPsWEeSnQvDHoYok5w/workitems/services.xml",
		    "@type" : "oslc:ServiceProvider",
		    "consumerRegistry" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/process/project-areas/_pMhMgPsWEeSnQvDHoYok5w/links",
		    "globalConfigurationAware" : "compatible",
		    "supportContributionsToLinkIndexProvider" : "true",
		    "supportLinkDiscoveryViaLinkIndexProvider" : "false",
		    "details" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/process/project-areas/_pMhMgPsWEeSnQvDHoYok5w",
		    "title" : "JKE Banking (Change Management)"
		}
      ],
    "publisher" : {
	    "@type" : "oslc:Publisher",
	    "icon" : "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm/web/com.ibm.team.rtc.web/ui/graphics/UICustomizations/RationalTeamConcert.ico",
	    "identifier" : "com.ibm.team.workitem",
	    "title" : "IBM Rational Team Concert Work Items"
    },
    "title" : "Project Areas"
}];

console.log("ServiceProvider for JKE Banking (Change Management):");
console.log(sift({
		title: "JKE Banking (Change Management)"
}, spc[0].serviceProvider))



