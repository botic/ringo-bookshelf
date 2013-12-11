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

app.get("/", function(req) {
   var credentials = getCredentials(req);

   if (credentials.isLoggedIn) {
      return response.html(env.getTemplate("frontpage.html").render({
         title: "Hallo",
         username: credentials.principal.getName(),
         logoutURI: credentials.logoutURI
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
   for (var i = 0, book; i < books.size(); i++) {
      book = books.get(i);
      booksArray.push({
         title: book.getProperty("title")
      });
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
      if (req.postParams.title && req.postParams.title.length >= 1) {
         var datastore = DatastoreServiceFactory.getDatastoreService();
         
         var book = new Entity("Book", bookshelf.getKey());
         book.setProperty("title", req.postParams.title);
         book.setProperty("titleLowerCase", req.postParams.title.toLowerCase());
         book.setProperty("created", new java.util.Date());
         book.setProperty("creator", credentials.currentUser);
         datastore.put(book);
      }
   }

   return response.redirect("/bookshelf/" + id);
});
