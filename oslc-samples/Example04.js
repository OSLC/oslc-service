// This is the same example as 
// A simple example OSLC client application that demonstrates how to utilize
// typical OSLC integration capabilities for doing CRUD operations on resource.
// The example is based on the OSLC Workshop example at:
// /Users/jamsden/Documents/workspace/net.jazz.oslc.consumer.oslc4j.cm.client
// Example04.java, but in JavaScript and using Node.js and a prototype of oslc.js

var OSLCServer = require('oslc-client');

// setup information - server, user, project area, work item to update
serverURI = "https://oslclnx2.rtp.raleigh.ibm.com:9443/ccm";	// Set the Public URI of your RTC server
userID = "jamsden";		// Set the user login 
password = "matjas3cha";	// Set the associated password
projectAreaName = "JKE Banking (Change Management)"; // Set the project area name where is located the Work Item/Change Request to be changed
changeRequestID = "7";	// Set the Work Item/Change Request # to change

cmServer = new OSLCServer(serverURI);

// Connect to the CM server, use a project area, and do some
// operations on resources. All operations are asynchronous but often have 
// to be done in a specific order.

cmServer.connect(userID, password, function doneConnecting(err) {
	if (err) return console.log('Unable to connect to server '+err);

	cmServer.use(projectAreaName, function doneUsing(err) {
		if (err) return console.log('Unable to use project area '+err);

		// Do whatever the client/server needs to do to the project area
		updateChangeRequest();
	});
});

// An example of using an asynchronous callback function to package up
// some interactions with a CM server. Again the calls are all asychronous 
// but have to be done in a specific order.
// This example gets a change request, modifies it, and puts it back.

function updateChangeRequest() {
	cmServer.read(changeRequestID, function gotChangeRequest(err, changeRequest) {
		if (err) return console.log('Unable to read change request '+err);

		// Make some simple change we can see in the repository
		changeRequest.description = changeRequest.description + new Date();
		cmServer.update(changeRequest, function doneUpdating(err) {
			if (err) return console.log('Unable to update change request '+err);

			console.log('>> Updated Change Request ['+changeRequestID+'] or: '+changeRequest.title);
			cmServer.disconnect();
			console.log('Done');
		});
	});
			
}

console.log('Waiting for change request to update...');
