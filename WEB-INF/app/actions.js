importPackage(com.google.appengine.api.users);
importPackage(com.google.appengine.api.images);
importPackage(com.google.appengine.api.datastore);
importPackage(com.google.appengine.api.blobstore);

var strings = require("ringo/utils/strings");

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
   var parentKey = entity.getParent();
   var map = entity.getProperties();
   var obj = {
      id: entity.getKey().getId(),
      parentId: (parentKey !== null ? parentKey.getId() : null)
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
         title: "Bookshelf - " + credentials.principal.getName(),
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
         title: "Create Bookshelf",
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
      bookshelfId: id,
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
         (req.postParams.year == "" || filterInt(req.postParams.year, 10) !== NaN)) {
         var datastore = DatastoreServiceFactory.getDatastoreService();
         
         var book = new Entity("Book", bookshelf.getKey());
         book.setProperty("title", req.postParams.title);
         book.setProperty("titleLowerCase", req.postParams.title.toLowerCase());
         book.setProperty("created", new java.util.Date());
         book.setProperty("creator", credentials.currentUser);
         book.setProperty("author", req.postParams.author);
         book.setProperty("publisher", req.postParams.publisher);

         if (req.postParams.year !== "") {
            book.setProperty("year", java.lang.Integer.parseInt(req.postParams.year));
         } else {
            book.setProperty("year", null);
         }

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

   // Check if request url is consistent
   if (!bookshelf.getKey().equals(book.getParent())) {
      return response.notFound().html("<h1>Book not found</h1>");
   }

   // Check if the user is the owner of a bookshelf
   var credentials = getCredentials(req);
   if (credentials.isLoggedIn && credentials.currentUser.equals(bookshelf.getProperty("creator"))) {
      return response.html(env.getTemplate("bookAdmin.html").render({
         title: book.getProperty("title"),
         book: mapProperties(book),
         bookshelf: mapProperties(bookshelf),
         username: credentials.principal.getName(),
         logoutURI: credentials.logoutURI
      }));
   }

   return response.html(env.getTemplate("book.html").render({
      title: book.getProperty("title"),
      book: mapProperties(book),
      bookshelf: mapProperties(bookshelf)
   }));
});

app.get("/bookshelf/:shelfId/:bookId/upload", function(req, shelfId, bookId) {
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
   if (credentials.isLoggedIn && credentials.currentUser.equals(bookshelf.getProperty("creator")) &&
         bookshelf.getKey().equals(book.getParent())) {
      
      // BlobstoreService to create upload url
      var blobstoreService = BlobstoreServiceFactory.getBlobstoreService();

      return response.html(env.getTemplate("uploadCover.html").render({
         uploadUrl: blobstoreService.createUploadUrl("/bookshelf/" + shelfId + "/" + bookId + "/upload"),
         title: book.getProperty("title"),
         book: mapProperties(book),
         bookshelf: mapProperties(bookshelf),
         username: credentials.principal.getName(),
         logoutURI: credentials.logoutURI
      }));
   }

   return response.redirect("/bookshelf/" + id);
});

app.post("/bookshelf/:shelfId/:bookId/upload", function(req, shelfId, bookId) {
   var datastore = DatastoreServiceFactory.getDatastoreService();
   var bookshelf, bookshelfKey;
   var invalidCall = false;

   try {
      bookshelfKey = KeyFactory.createKey("Bookshelf", java.lang.Long.parseLong(shelfId));
      bookshelf = datastore.get(bookshelfKey);
   } catch (e) {
      invalidCall = true;
   }

   var book; 
   try {
      book = datastore.get(bookshelfKey.getChild("Book", java.lang.Long.parseLong(bookId)));
   } catch (e) {
      invalidCall = true;
   }

   // BlobstoreService to create upload url
   var blobstoreService = BlobstoreServiceFactory.getBlobstoreService();
   var blobs = blobstoreService.getUploads(req.env.servletRequest);

   // Check if the user is the owner of a bookshelf
   var credentials = getCredentials(req);
   if (!invalidCall && credentials.isLoggedIn && credentials.currentUser.equals(bookshelf.getProperty("creator")) &&
         bookshelf.getKey().equals(book.getParent())) {
      
      // Get the uploaded cover blob
      var blobKeys = blobs.get("coverFile");

      // Drop blobs if upload was invalid
      if(blobs.size() !== 1 || blobKeys == null || blobKeys.size() !== 1) {

      } else {
         var blobInfos = blobstoreService.getBlobInfos(req.env.servletRequest).get("coverFile");

         // Check uploaded mime types
         if (strings.startsWith(blobInfos.get(0).getContentType(), "image/")) {
            var imagesService = ImagesServiceFactory.getImagesService();

            // Store references to the blob
            book.setProperty("coverKey", blobKeys.get(0));
            book.setProperty("coverUrl", imagesService.getServingUrl(ServingUrlOptions.Builder.withBlobKey(blobKeys.get(0))));
            book.setProperty("coverUrlSecure", imagesService.getServingUrl(ServingUrlOptions.Builder.withBlobKey(blobKeys.get(0)).secureUrl(true)));
            datastore.put(book);

            return response.redirect("/bookshelf/" + shelfId + "/" + bookId);
         }
      }
   }

   // Delete Blobs
   blobs.values().toArray().forEach(function(keyList) {
      keyList.toArray().forEach(function(key) {
         blobstoreService.delete(key);
      });
   });

   return response.redirect("/bookshelf/" + shelfId);
});
