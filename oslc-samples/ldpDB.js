
/**
Start by defining an abstract library of reusable constants and functions.
*/


/** @namespace ldpDB */

(function ldpDB(exports, injectedDependency) {
	"use strict"
    var constants = Object.freeze({
        name: "value",
    })
    var message = injectedDependency
	var ldpDB = {
        create: function(resource, template) {throw "unimplemented"},
        read:   function(uri) {throw "unimplemented"},
        write:  function(resource) {throw "unimplemented"},
        delete: function(uri) {throw "unimplemented"},
        query:  function(queryString) {throw "unimplemented"}
    }

    // all the exports are defined in one place using the variables above
	exports.constants = constants
    exports.message = message
    exports.ldpDB = ldpDB
})(this, "dependency:1");

/** after executing the above, this will contain ldpDB.create() methods and constants.name constants */

console.log(this.constants.name)
console.log(this.message)
try {
    this.ldpDB.create({}, {})
} catch (err) {
    console.log("Error: "+err)
}

/** now we instantiate the facade on a concrete implementation. We do this
by replacing each of the methods in the abstract implementation with a new concrete implementation
*/

/** @namespace ldpMongoDB */

(function ldpMongoDB(exports, injectedDependency) {
    // should check to be sure the required modules for the implementation are loaded
    (function() {
        this.message = arguments[0]
        this.ldpDB.create = function(resource, template) {console.log("MongoDB create")}
        this.ldpDB.read = function(resource, template) {console.log("MongoDB read")}
        this.ldpDB.update = function(resource, template) {console.log("MongoDB update")}
        this.ldpDB.delete = function(resource, template) {console.log("MongoDB delete")}
        this.ldpDB.query = function(resource, template) {console.log("MongoDB query")}
    }).apply(exports, [injectedDependency])
})(this, "dependency:2")

// The ldpDB methods in this now have different implementations 

console.log(this.constants.name)
console.log(this.message)
try {
    this.ldpDB.create({}, {})
} catch (err) {
    console.log("Error: "+err)
}

/** The above implementation uses apply to apply the a function to a given object. This
 * uses a common JavaScript pattern to apply a function to different objects without 
 * adding the function to the object or its prototype. This is useful in situations where
 * the same function is applied to different objects, but usually only once and never called
 * again.
 *
 * With apply, you can write a method once and then inherit it in another object, without 
 * having to rewrite the method for the new object.
 *
 * try a different implementation 
 */

/** @namespace ldpMongoDB */

(function ldpMongoDB2(exports, injectedDependency) {
    // should check to be sure the required modules for the implementation are loaded
    "use strict"
    exports.constants = Object.freeze({
        name: "value2",
    })
    exports.message = injectedDependency
    exports.ldpDB.create = function(resource, template) {console.log("MongoDB new create")}
    exports.ldpDB.read = function(resource, template) {console.log("MongoDB new read")}
    exports.ldpDB.update = function(resource, template) {console.log("MongoDB new update")}
    exports.ldpDB.delete = function(resource, template) {console.log("MongoDB new delete")}
    exports.ldpDB.query = function(resource, template) {console.log("MongoDB new query")}
})(this, "dependency:3")

// The methods should now have a different implementation

console.log(this.constants.name)
console.log(this.message)
try {
    this.ldpDB.create({}, {})
} catch (err) {
    console.log("Error: "+err)
}

// extend another object with ldpDB capabilities

function ldpMongoDB3(exports, injectedDependency) {
    // should check to be sure the required modules for the implementation are loaded
    "use strict"
    exports.constants = Object.freeze({
        name: "value3",
    })
    exports.message = injectedDependency
    exports.create = function(resource, template) {console.log("MongoDB new3 create")}
    exports.read = function(resource, template) {console.log("MongoDB new3 read")}
    exports.update = function(resource, template) {console.log("MongoDB new3 update")}
    exports.delete = function(resource, template) {console.log("MongoDB new3 delete")}
    exports.query = function(resource, template) {console.log("MongoDB new3 query")}
}

var db = {}
ldpMongoDB3(db, "dependency:4")
console.log(db.constants.name)
console.log(db.message)
try {
    db.create({}, {})
} catch (err) {
    console.log("Error: "+err)
}





