# oslc-service

[![Discourse status](https://img.shields.io/discourse/https/meta.discourse.org/status.svg)](https://forum.open-services.net/)
[![Gitter](https://img.shields.io/gitter/room/nwjs/nw.js.svg)](https://gitter.im/OSLC/chat)

A Node.js module providing Express middleware to create an [OSLC 3.0](https://tools.oasis-open.org/version-control/svn/oslc-core/trunk/specs/oslc-core.html) server. The service uses the ldp-service Express middleware module which provides a database of the user's choosing for persistence, jsonld.js for JSON-LD support, and a few other JavaScript libraries.  A sample app using the OSLC middleware service is running at [http://oslc-browser.mybluemix.net](http://oslc-browser.mybluemix.net).

oslc-service supports any OSLC Domain by including the domain vocabulary URIs at open-services.net/ns in the config.json file.

Many thanks to Steve Speicher and Sam Padgett for their valuable contribution to LDP and the LDP middleware upon which this service is built.

Module planning, maintenance and issues can be see at at the [oslc-service](https://hub.jazz.net/project/jamsden/oslc-service/overview) IBM Bluemix DevOps Services project.


## Using oslc-service

1) Install the required modules

Install [Node.js](http://nodejs.org).

Run your database. Below are instructions for using oslc-service with the Apache Jena Fuseki database.

Start [Jena](https://jena.apache.org/download/index.cgi). Download apache-jena-fuseki-2.4.1.tar.gz under Apache Jena Fuseki and unzip it.

To run Jena, enter the following code

	$ fuseki-server --mem /ldp

/ldp is a datastore that allows the request to access the resources on the db. It can be named in any other way. --mem allows for temporary storage of data
for that instant. For the data to permantently store data (and to update data), the following code should be ran.

	$ fuseki-server --update --loc=<path to db> /ldp

--update allows the user to update resources, while --loc tells the location of the stored items for persistence.

Install express.js and create a sample express app

	$ npm install express -g
	$ express --git -e <appDir>

2) Edit the package.json file to add a dependency on ldp-service

	"dependencies": {"oslc-service": "~0.0.1"},

3) Edit app.js and add whatever Express middleware you need including ldp-service. ldp-service can be customized to support any type of database (it is currently in production). For setting up ldp-service, we will use ldp-service-jena as an example. ldp-service-jena provides access to its Apache Jena database in case additional middleware needs direct access to the database. ldp-service-jena has not been published to npm yet, so it will need to be access locally.

	var ldpService = require('./ldp-service-jena');
	app.use(ldpService());
	var db = ldpService.db; // incase further middleware needs access to the database

4) Configuration defaults can be found in config.json. These may be overridden by variables in the environment, including Bluemix variables if deployed in a Bluemix app.

5) To start the app, run these commands

    $ npm install
    $ node app.js

Finally, point your browser to
[http://localhost:3000/](http://localhost:3000/).

To test the oslc-server, we recommend using a browser based REST client that sends requests to http://localhost:3000/. One example is Mozilla Firefox's [RESTClient](https://addons.mozilla.org/en-US/firefox/addon/restclient/).

## License

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

   http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
