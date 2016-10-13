/*
 * Vocab for the OSLC service
 * Defines the properties that can be incorporated
 * into the OSLC service
 *
*/

function define(name, value) {
    Object.defineProperty(exports, name, {
        value:      value,
        enumerable: true
    });
}

var oslc = 'http://open-services.net/ns/core#';

define('oslc', oslc);
define('ResponseInfo', oslc+'ResponseInfo');
define('Exactly-one', oslc+'Exactly-one');
define('Zero-or-one', oslc+'Zero-or-one');
define('Zero-or-many', oslc+'Zero-or-many');
define('One-or-many', oslc+'One-or-many');

define('ServiceProviderCatalog', oslc+'ServiceProviderCatalog');
define('ServiceProvider', oslc+'ServiceProvider');
define('Service', oslc+'Service');
define('service', oslc+'service');

define('CreationFactory', oslc+'CreationFactory');
define('creationFactory', oslc+'creationFactory');
define('creation', oslc+'creation');

define('QueryCapability', oslc+'QueryCapability');
define('queryCapability', oslc+'queryCapability');
define('queryBase', oslc+'queryBase');

define('Dialog', oslc+'Dialog');
define('creationDialog', oslc+'creationDialog');
define('selectionDialog', oslc+'selectionDialog')
define('dialog', oslc+'dialog');

define('Publisher', oslc+'Publisher');
define('icon', oslc+'icon');

define('PrefixDefinition', oslc+'PrefixDefinition');
define('prefix', oslc+'prefix');
define('prefixBase', oslc+'prefixBase');

define('OAuthConfiguration', oslc+'OAuthConfiguration');
define('oauthRequestTokenURI', oslc+'oauthRequestTokenURI');
define('authorizationURI', oslc+'authorizationURI');
define('oauthAccessTokenURI', oslc+'oauthAccessTokenURI');

define('hintHeight', oslc+'hintHeight');
define('hintWidth', oslc+'hintWidth');

define('Error', oslc+'Error');
define('ExtendedError', oslc+'ExtendedError');

define('usage', oslc+'usage');
define('default', oslc+'default');
define('resourceShape', oslc+'resourceShape');
define('resourceType', oslc+'resourceType');
define('domain', oslc+'domain');
define('label', oslc+'label');

define('Property', oslc+'Property');
define('occurs', oslc+'occurs');
define('valueType', oslc+'valueType');
define('Resource', oslc+'Resource');
define('LocalResource', oslc+'LocalResource');
define('representation', oslc+'representation');

define('Inline', oslc+'Inline');
define('Reference', oslc+'Reference');


