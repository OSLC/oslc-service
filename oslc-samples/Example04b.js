// This is the same example as 
// A simple example OSLC client application that demonstrates how to utilize
// typical OSLC integration capabilities for doing CRUD operations on resource.
// The example is based on the OSLC Workshop example at:
// /Users/jamsden/Documents/workspace/net.jazz.oslc.consumer.oslc4j.cm.client
// Example04.java, but in JavaScript and using Node.js and a prototype of oslc.js

var OSLCServer = require('oslc-client');

// setup information - server, user, project area, work item to update
serverURI = "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm";	// Set the Public URI of your RTC server
userName = "jamsden";		// Set the user login 
password = "matjas3cha";	// Set the associated password
providerContainerName = "JKE Banking (Change Management)"; // Set the project area name where is located the Work Item/Change Request to be changed
changeRequestID = "7";	// Set the Work Item/Change Request # to change

server = new OSLCServer(serverURI);

// Define the program functions
// 
// This is another way to handle asynchronous functions that must be executed
// in a particular order. This top-level function represents the overall activity
// that we want to accomplish. It kicks off the first function in a series
// and processes the result. Each function represents a step in the process
// and its callback is the next step in the process.
//
// This is an alternative to using async. But the issue is that it is not clear
// from reading the code what the order of the functions is, or that there is any
// required order. 
//
(function exampleOSLCClientApp() {connect(function(err, result) {
		if (!err) {;
			console.log("Updated a change request "+result)
		} else {
			console.log(err);
		}
	});
})();

function connect(callback) {server.connect(userName, password, use);}
function use(callback) {server.use(providerContainerName, read);}
function read(callback) {
	server.read(changeRequestID, function(err, result) {
		if (!err) {
			changeRequest = result;
			console.log('Got Change Request: ')
			console.log(changeRequest);
		}
		update(callback);
	});
}
function update(callback) {
	changeRequest.description = changeRequest.description + new Date();
	server.update(changeRequest, function (err) {
		if (!err) console.log('Updated: '+changeRequest.id);			
		cleanup(callback);
	});
}
function cleanup(callback) {
	server.disconnect();
	console.log('Done');
}

console.log('Waiting for change request to update...');
