// The Application object is a JSGI application that wraps a middleware chain.
var {Application} = require("stick");

// This creates a new application
var app = exports.app = Application();

// This configures the middleware chain. It wil be executed in the follwing order:
// HTTP request --> [mount] --> [route] --> HTTP response
// Note: the order is very important!
app.configure("static", "mount", "route");
app.static(module.resolve("./public"), "index.html", "/static");

// This module provides response helper functions for composing JSGI response objects.
// Instead of creating the response object manually, we can use response.html("<html>...</html>");
var response = require("ringo/jsgi/response");

// Mount the api module
var actions = require("./actions");
app.mount("/", actions);
