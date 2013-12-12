importPackage(com.google.appengine.api.users);
importPackage(com.google.appengine.api.datastore);

var {Application} = require("stick");
var app = exports.app = new Application();
app.configure("params", "mount", "route");

var response = require("ringo/jsgi/response");

var {Environment} = require("reinhardt");
var env = new Environment({
   loader: module.resolve("WEB-INF/app/templates")
});

// From MDN - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/parseInt
var filterInt = function (value) {
   if(/^\-?([0-9]+)$/.test(value)) {
      return Number(value);
   }

   return NaN;
};

var getCredentials = function(req) {
   var requestURI = req.env.servletRequest.getRequestURI();
   var userService = UserServiceFactory.getUserService();
   var principal = req.env.servletRequest.getUserPrincipal();
   var isLoggedIn = false;

   try {
      isLoggedIn = userService.isUserLoggedIn();
   } catch (e) {
      isLoggedIn = false;
   }

   return {
      isLoggedIn: isLoggedIn,
      isAdmin: !isLoggedIn ? false : userService.isUserAdmin(),
      currentUser: !isLoggedIn ? null : userService.getCurrentUser(),
      principal: !isLoggedIn ? null : principal,
      logoutURI: userService.createLogoutURL(requestURI),
      loginURI: userService.createLoginURL(requestURI)
   };
};

var mapProperties = function(entity) {
   var map = entity.getProperties();
   var obj = {
      id: entity.getKey().getId(),
      parentId: entity.getParent().getId()
   };

   map.keySet().toArray().forEach(function(key) {
      obj[key] = map.get(key);
   });

   return obj;
};

app.get("/", function(req) {
   var credentials = getCredentials(req);

   if (credentials.isLoggedIn) {
      var datastore = DatastoreServiceFactory.getDatastoreService();
      
      // Retrieve books of this bookshell
      var shelfs = datastore.prepare(new Query("Bookshelf")
         .addFilter("creator", Query.FilterOperator.EQUAL, credentials.currentUser)
         .addSort("created", Query.SortDirection.ASCENDING))
         .asList(FetchOptions.Builder.withDefaults());

      var shelfArray = [];
      for (var i = 0; i < shelfs.size(); i++) {
         shelfArray.push(mapProperties(shelfs.get(i)));
      }

      return response.html(env.getTemplate("frontpage.html").render({
         title: "Hallo",
         username: credentials.principal.getName(),
         logoutURI: credentials.logoutURI,
         shelfs: shelfArray
      }));
   }

   return response.redirect(credentials.loginURI);
});

app.get("/createBookshelf", function(req) {
   var credentials = getCredentials(req);

   if (credentials.isLoggedIn) {
      return response.html(env.getTemplate("createBookshelf.html").render({
         title: "Hallo",
         username: credentials.principal.getName(),
         logoutURI: credentials.logoutURI
      }));
   }

   return response.redirect(credentials.loginURI);
});


app.post("/createBookshelf", function(req) {
   var credentials = getCredentials(req);

   if (credentials.isLoggedIn) {
      if (req.postParams.title && req.postParams.title.length >= 3) {
         var datastore = DatastoreServiceFactory.getDatastoreService();
         
         var bookshelf = new Entity("Bookshelf");
         bookshelf.setProperty("title", req.postParams.title);
         bookshelf.setProperty("created", new java.util.Date());
         bookshelf.setProperty("creator", credentials.currentUser);
         datastore.put(bookshelf);
 
         return response.redirect("./bookshelf/" + bookshelf.getKey().getId());
      }

      return response.redirect("./createBookshelf");
   }

   return response.redirect(credentials.loginURI);
});

app.get("/bookshelf/:id", function(req, id) {
   var datastore = DatastoreServiceFactory.getDatastoreService();
   var bookshelf; 
   try {
      bookshelf = datastore.get(KeyFactory.createKey("Bookshelf", java.lang.Long.parseLong(id)));
   } catch(e if e.javaException instanceof EntityNotFoundException) {
      return response.notFound().html("<h1>Bookshelf not found</h1>");
   } catch (e) {
      return response.error().html("<h1>Internal error</h1>");
   }

   // Retrieve books of this bookshell
   var books = datastore.prepare((new Query("Book")).setAncestor(bookshelf.getKey()).addSort("titleLowerCase", Query.SortDirection.ASCENDING)).asList(FetchOptions.Builder.withDefaults());
   var booksArray = [];
   for (var i = 0; i < books.size(); i++) {
      booksArray.push(mapProperties(books.get(i)));
   }

   // Check if the user is the owner of a bookshelf
   var credentials = getCredentials(req);
   if (credentials.isLoggedIn && credentials.currentUser.equals(bookshelf.getProperty("creator"))) {
      return response.html(env.getTemplate("bookshelfAdmin.html").render({
         title: bookshelf.getProperty("title"),
         bookshelfId: id,
         books: booksArray,
         username: credentials.principal.getName(),
         logoutURI: credentials.logoutURI
      }));
   }

   return response.html(env.getTemplate("bookshelf.html").render({
      title: bookshelf.getProperty("title"),
      books: booksArray
   }));
});

app.post("/bookshelf/:id", function(req, id) {
   var datastore = DatastoreServiceFactory.getDatastoreService();
   var bookshelf; 
   try {
      bookshelf = datastore.get(KeyFactory.createKey("Bookshelf", java.lang.Long.parseLong(id)));
   } catch(e if e.javaException instanceof EntityNotFoundException) {
      return response.notFound().html("<h1>Bookshelf not found</h1>");
   } catch (e) {
      return response.error().html("<h1>Internal error</h1>");
   }

   // Check if the user is the owner of a bookshelf
   var credentials = getCredentials(req);
   if (credentials.isLoggedIn && credentials.currentUser.equals(bookshelf.getProperty("creator"))) {
      if (req.postParams.title && req.postParams.title.length >= 1 &&
         ((req.postParams.year == null && req.postParams.year == "") || filterInt(req.postParams.year, 10) !== NaN)) {
         var datastore = DatastoreServiceFactory.getDatastoreService();
         
         var book = new Entity("Book", bookshelf.getKey());
         book.setProperty("title", req.postParams.title);
         book.setProperty("titleLowerCase", req.postParams.title.toLowerCase());
         book.setProperty("created", new java.util.Date());
         book.setProperty("creator", credentials.currentUser);
         book.setProperty("author", req.postParams.author);
         book.setProperty("publisher", req.postParams.publisher);
         book.setProperty("year", java.lang.Integer.parseInt(req.postParams.year));
         book.setProperty("edition", req.postParams.edition);
         book.setProperty("isbn13", req.postParams.isbn13);
         book.setProperty("isbn10", req.postParams.isbn10);
         book.setProperty("issn", req.postParams.issn);
         book.setProperty("dimensions", req.postParams.dimensions);
         datastore.put(book);
      }
   }

   return response.redirect("/bookshelf/" + id);
});

app.get("/bookshelf/:shelfId/:bookId", function(req, shelfId, bookId) {
   var datastore = DatastoreServiceFactory.getDatastoreService();
   var bookshelf, bookshelfKey; 
   try {
      bookshelfKey = KeyFactory.createKey("Bookshelf", java.lang.Long.parseLong(shelfId));
      bookshelf = datastore.get(bookshelfKey);
   } catch(e if e.javaException instanceof EntityNotFoundException) {
      return response.notFound().html("<h1>Bookshelf not found</h1>");
   } catch (e) {
      return response.error().html("<h1>Internal error</h1>");
   }

   var book; 
   try {
      book = datastore.get(bookshelfKey.getChild("Book", java.lang.Long.parseLong(bookId)));
   } catch(e if e.javaException instanceof EntityNotFoundException) {
      return response.notFound().html("<h1>Book not found</h1>");
   } catch (e) {
      return response.error().html("<h1>Internal error</h1>");
   }

   // Check if the user is the owner of a bookshelf
   var credentials = getCredentials(req);
   if (credentials.isLoggedIn && credentials.currentUser.equals(bookshelf.getProperty("creator"))) {      
      return response.text(mapProperties(book).toSource());
   }

   return response.redirect("/bookshelf/" + id);
});
