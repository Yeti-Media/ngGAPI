'use strict';

angular.module('gapi', [])

  /**
   * GAPI exposes many services, but their respective APIs follow
   * a pattern. This is fortunate. We can define a core abstraction
   * for communicating with all google apis, and then specialize it
   * for each service.
   *
   * The reponsibility of this general service is to implement the 
   * authorization flow, and make requests on behalf of a dependent
   * API specific service.
   *
   * Each google API maps specific methods to HTTP verbs.
   *
   *     METHOD         HTTP
   *     list           GET
   *     insert         POST
   *     update         PUT
   *     delete         DELETE
   *     etc            ...
   *
   * Among the collected API's, these methods appear to map consistently.
   */



  .factory('GAPI', function ($q, $http, GoogleApp) {

    /**
     * GAPI Credentials
     */

    GAPI.app = GoogleApp;


    /**
     * Google APIs base URL
     */

    var server = 'https://www.googleapis.com';


    /**
     * Generate a method name from an action and a resource
     */

    function methodName (action, resource) {
      // allow resources with a path prefix
      resource = resource.split('/').pop()
      // uppercase the first character
      resource = resource.charAt(0).toUpperCase() + resource.slice(1);
      return action + resource;
    }


    /**
     * Recurse through a "spec" object and create methods for 
     * resources and nested resources.
     * 
     * For each resource in the provided spec, we define methods
     * for each of the its actions.
     */
    
    function createMethods (service, spec, parents) {
      var resources = Object.keys(spec);

      resources.forEach(function (resource) {
        var actions = spec[resource];

        actions.forEach(function (action) {
          
          // if the action is an object, treat it as a nested
          // spec and recurse
          if (typeof action === 'object') {

            if (!parents) { parents = []; }
            // we can't keep passing around the 
            // same array, we need a new one
            var p = parents.concat([resource]); 
            createMethods(service, action, p);

          } else {
          
            var method = methodName(action, resource);
            service[method] = GAPI[action](resource, parents);              
          
          }
        });
      });
    }


    /**
     * GAPI Service Constructor
     */

    function GAPI (api, version, spec) {
      this.api     = api;
      this.version = version;
      this.url     = [ server, api, version, '' ].join('/');

      createMethods(this, spec);
    }


    /**
     * OAuth 2.0 Signatures
     */

    function oauthHeader(options) {
      if (!options.headers) { options.headers = {}; }
      options.headers['Authorization'] = 'Bearer ' + GAPI.app.access_token;      
    }

    function oauthParams(options) {
      if (!options.params) { options.params = {}; }
      options.params.access_token = GAPI.app.access_token;      
    }

    
    /**
     * HTTP Request Helper
     */

    function request (config) {
      var deferred = $q.defer();

      oauthHeader(config);

      function success(response) {
        deferred.resolve(response.data);
      }

      function failure(fault) {
        deferred.reject(fault);
      }

      $http(config).then(success, failure);
      return deferred.promise;
    }


    GAPI.request = request;


    /**
     * HTTP GET method available on service instance
     */

    GAPI.prototype.get = function () {
      var args = Array.prototype.slice.call(arguments)
        , path = []
        , params
        ;

      args.forEach(function (arg, i) {
        if (arg && typeof arg !== 'object') {
          path.push(arg); 
        } else {
          params = arg
        }
      });  

      return request({
        method: 'GET',
        url:    this.url + path.join('/'),
        params: params
      });
    };


    /**
     * HTTP POST method available on service instance
     */

    GAPI.prototype.post = function () {
      var args = Array.prototype.slice.call(arguments)
        , path = []
        , other = 0
        , data
        , params
        ;

      args.forEach(function (arg, i) {
        if (!arg || typeof arg === 'object') { // if the arg is not part of the path
          other += 1;                          // increment the number of nonpath args
          if (other === 1) { data   = arg; }
          if (other === 2) { params = arg; }
        } else {                               // if the arg is defined and not and object
          path.push(arg);                      // push to the path array
        }
      });

      return request({
        method: 'POST',
        url:    this.url + path.join('/'),
        data:   data,
        params: params
      });            
    }


    /**
     * Build a resource url, optionally with nested resources
     */

    function resourceUrl (args, parents, base, resource) {
      var argIndex = 0
        , nodes = []
        , params = args[args.length.toString()]
        ;

      if (parents && parents.length > 0) {
        parents.forEach(function (parent, i) {
          nodes.push(parent, args[i.toString()])
          argIndex += 1;
        });
      } 

      nodes.push(resource);
      if (['string', 'number'].indexOf(typeof args[argIndex.toString()]) !== -1) {
        nodes.push(args[argIndex.toString()]);
      }

      return base += nodes.join('/');
    }


    /**
     * Parse params from arguments
     */

    function parseParams (args) {
      var last = args[(args.length - 1).toString()];
      return (typeof last === 'object') ? last : null      
    }


    /**
     * Parse data and params from arguments
     */

    function parseDataParams (a) {
        var args = Array.prototype.slice.call(a)
          , parsedArgs = {}
          , other = 0
          ;

        args.forEach(function (arg, i) {
          if (!arg || typeof arg === 'object') {
            other += 1;                         
            if (other === 1) { parsedArgs.data   = arg; }
            if (other === 2) { parsedArgs.params = arg; }
          } 
        });

        return parsedArgs;
    }


    /**
     * Resource methods
     * 
     * These methods are used to construct a service.
     * They are not intended to be called directly on GAPI.
     */


    GAPI.get = function (resource, parents) {
      return function () {
        return request({
          method: 'GET',
          url:    resourceUrl(arguments, parents, this.url, resource),
          params: parseParams(arguments)
        });
      };
    };


    GAPI.set = function (resource, parents) {
      return function () {
        return request({
          method: 'POST',
          url:    resourceUrl(arguments, parents, this.url, resource) + '/set', 
          params: parseParams(arguments)
        });
      };
    };


    GAPI.unset = function (resource, parents) {
      return function () {
        return request({
          method: 'POST',
          url:    resourceUrl(arguments, parents, this.url, resource) + '/unset', 
          params: parseParams(arguments)
        });
      };
    };    


    GAPI.list = function (resource, parents) {
      return function () {
        return request({
          method: 'GET',
          url:    resourceUrl(arguments, parents, this.url, resource),
          params: parseParams(arguments)
        });
      };
    };
    

    GAPI.insert = function (resource, parents) {
      return function () {
        var args = parseDataParams(arguments);
        return request({
          method: 'POST',
          url:    resourceUrl(arguments, parents, this.url, resource), 
          data:   args.data,
          params: args.params
        });
      };
    };
    

    GAPI.update = function (resource, parents) {
      return function () {
        var args = parseDataParams(arguments);
        return request({
          method: 'PUT',
          url:    resourceUrl(arguments, parents, this.url, resource),
          data:   args.data,
          params: args.params
        });
      };
    };

  
    GAPI.patch = function (resource, parents) {
      return function () {
        var args = parseDataParams(arguments);
        return request({
          method: 'PATCH',
          url:    resourceUrl(arguments, parents, this.url, resource),
          data:   args.data,
          params: args.params
        });
      };
    };


    GAPI.delete = function (resource, parents) {
      return function () {
        return request({
          method: 'DELETE',
          url:    resourceUrl(arguments, parents, this.url, resource),
          params: parseParams(arguments)
        });
      };
    };


    /**
     * Authorization
     */

    GAPI.init = function (access_token) {
      GAPI.app.access_token = access_token;
    }



  });
