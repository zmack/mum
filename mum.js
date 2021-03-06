HOST = null; // localhost
PORT = 8001;

var base = require("./base_server");
var sys = require("sys");

var MESSAGE_BACKLOG = 200;
var SESSION_TIMEOUT = 60 * 1000;

var Map = function () {
  var messages = [];
  var callbacks = [];
  var puppies = [];

  var self = this;

  function sendToPuppies(message) {
    var json = JSON.stringify(message);
    sys.puts(json);
    for( var i = 0, n = puppies.length; i < n; i++ ) {
      puppies[i].sendBody(json, 'utf-8');
    }
  }

  this.appendMessage = function (nick, type, text) {
    var m = { nick: nick
            , type: type // "msg", "join", "part"
            , text: text
            , timestamp: (new Date()).getTime()
            };

    switch (type) {
      case "msg":
        sys.puts("<" + nick + "> " + text);
        break;
      case "join":
        sys.puts(nick + " join");
        break;
      case "part":
        sys.puts(nick + " part");
        break;
    }

    sendToPuppies(m);
  };

  this.addClientToUpdateCallbacks = function(res) {
    res.sendHeader(200, [
      ["Content-Type", "text/json"],
      ["Transfer-Encoding", "chunked"],
      ["Keep-Alive", "timeout=20, max=300"]
    ]);

    res.addListener('timeout', function() { sys.puts("connection timed out") });
    res.addListener('eof', function() { sys.puts("connection eof'ed") });

    puppies.push(res);
  }

  this.query = function (since, callback) {
    var matching = [];
    for (var i = 0; i < messages.length; i++) {
      var message = messages[i];
      if (message.timestamp > since)
        matching.push(message)
    }

    if (matching.length != 0) {
      callback(matching);
    } else {
      callbacks.push({ timestamp: new Date(), callback: callback });
    }
  };

  // Heartbeat every 10 seconds
  setInterval(function() {
    self.appendMessage('server', 'msg', '<3');
  }, 10000);

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  setInterval(function () {
    var now = new Date();
    while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
      callbacks.shift().callback([]);
    }
  }, 1000);
};

var maps = new function() {
  var maps = {};

  this.getOrCreateMap = function(id) {
    if ( maps[id] == null ) {
      maps[id] = new Map();
    }

    return maps[id];
  }

  this.deleteMap = function(id) {
    var map = maps[id];
    delete(maps[id]);

    return map;
  }
}

var sessions = {};

function createSession (nick) {
  if (nick.length > 50) return null;
  if (/[^\w_\-^!]/.exec(nick)) return null;

  for (var i in sessions) {
    var session = sessions[i];
    if (session && session.nick === nick) return null;
  }

  var session = { 
    nick: nick, 

    id: Math.floor(Math.random()*99999999999).toString(),

    timestamp: new Date(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      channel.appendMessage(session.nick, "part");
      delete sessions[session.id];
    }
  };

  sessions[session.id] = session;
  return session;
}

// interval to kill off old sessions
setInterval(function () {
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];

    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }
}, 1000);

base.listen(PORT, HOST);

base.get("/", base.staticHandler("index.html"));
base.get("/style.css", base.staticHandler("style.css"));
base.get("/client.js", base.staticHandler("client.js"));
base.get("/jquery-1.2.6.min.js", base.staticHandler("jquery-1.2.6.min.js"));

base.get('/map', function(req, res) {
  var map = maps.getOrCreateMap(1);

  sys.puts('got map 1');
  sys.puts(map);
  res.simpleText(200, map.toString());
});

base.get('/update', function(req, res) {
  var map = maps.getOrCreateMap(1);
  
  map.addClientToUpdateCallbacks(res);
});

base.get('/foo', function(req, res) {
  var map = maps.getOrCreateMap(1);

  map.appendMessage('foo', 'msg', 'baz');
  res.simpleText(200, '');
});

base.get("/who", function (req, res) {
  var nicks = [];
  sys.puts(req.connection.remoteAddress);
  sys.puts(req.headers);
  for ( i in req.headers ) {
    sys.puts(i + " -- " + req.headers[i]);
  }

  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];
    nicks.push(session.nick);
  }
  res.simpleJSON(200, { nicks: nicks });
});

base.get("/join", function (req, res) {
  var nick = req.uri.params["nick"];
  if (nick == null || nick.length == 0) {
    res.simpleJSON(400, {error: "Bad nick."});
    return;
  }
  var session = createSession(nick);
  if (session == null) {
    res.simpleJSON(400, {error: "Nick in use"});
    return;
  }

  //sys.puts("connection: " + nick + "@" + res.connection.remoteAddress);

  channel.appendMessage(session.nick, "join");
  res.simpleJSON(200, { id: session.id, nick: session.nick});
});

base.get("/part", function (req, res) {
  var id = req.uri.params.id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.destroy();
  }
  res.simpleJSON(200, { });
});

base.get("/recv", function (req, res) {
  if (!req.uri.params.since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }
  var id = req.uri.params.id;
  var session;
  if (id && sessions[id]) {
    session = sessions[id];
    session.poke();
  }

  var since = parseInt(req.uri.params.since, 10);

  channel.query(since, function (messages) {
    if (session) session.poke();
    res.simpleJSON(200, { messages: messages });
  });
});

base.get("/send", function (req, res) {
  var id = req.uri.params.id;
  var text = req.uri.params.text;

  var session = sessions[id];
  if (!session || !text) {
    res.simpleJSON(400, { error: "No such session id" });
    return; 
  }

  session.poke();

  channel.appendMessage(session.nick, "msg", text);
  res.simpleJSON(200, {});
});
