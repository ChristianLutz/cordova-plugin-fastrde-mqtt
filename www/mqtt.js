var mqtt={
  debug_deleteTable: true,
  host: null,
  port: null,
  qos: null,
  clientId: null,
  username: null,
  password: null,
  ssl: null,
  keepAlive: null,
  timeout: null,
  cleanSession: null,
  protocol: null,
  will: null,
  cache: null,
  reconnectInterval: 5,

  init: function(options){
    mqtt.host = required(options.host);
    mqtt.port = optional(options.port, 1883);
    mqtt.options = {
      qos  : optional(options.qos, 0),
      clientId : optional(options.clientId, 'cordova_mqtt_' + Math.random().toString(16).substr(2, 8)),
      username : optional(options.username, null),
      password : optional(options.password, null),
      ssl : optional(options.ssl, false),
      keepAlive : optional(options.keepAlive, 10),
      timeout : optional(options.timeout, 30),
      cleanSession : optional(options.cleanSession, true),
      protocol : optional(options.protocol, 4)
    };
    mqtt.offlineCaching = optional(options.offlineCaching, true);

    if (mqtt.offlineCaching){
      mqtt.cache = window.sqlitePlugin.openDatabase({name: "mqttcache.db", location: 'default'},
        function(db) {
          db.executeSql("PRAGMA synchronous=OFF", [], function(){
          }, function(error){
            console.log("PRAGMA error: ",error);
            return false;
          });
          if (mqtt.debug_deleteTable){
            db.transaction(function (tx) {
              tx.executeSql("DROP TABLE cache;",
                function createSuccess(tx, res) {
                  console.log("Cache DB dropped");
                }
              );
              mqtt.debug_deleteTable = false;
            });
          }
          db.transaction(function (tx) {
            tx.executeSql("CREATE TABLE IF NOT EXISTS cache(id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, message INT, qos INT, retain INT, sending INT)",[],
              function createSuccess(tx, res){
                console.log("Cache DB created");
                document.addEventListener("online", mqtt.onOnline, false);
                document.addEventListener("offline", mqtt.onOffline, false);
                if (!mqtt.isOnline()) {
                  mqtt._reconnect();
                }
                mqtt.onInit();
              },
              function createError(){
                console.error("Cache DB creation error");
                mqtt.onInitError();
                return false;
              });
          },
          function transactionError(error) {
            console.error("Cache DB transaction error: " + JSON.stringify(error));
            mqtt.onInitError();
            return false;
          });
        },
        function openDBError(err) {
          console.error('Cache DB open database error: ' + JSON.stringify(err));
          mqtt.onInitError();
          return false;
        }
      );
    }
  },

  will: function(message){
    mqtt.will = {
      topic: required(message.topic),
      message: required(message.message),
      qos: required(message.qos),
      retain: required(message.retain)
    };
  },

  on: function(evt, success, fail){
    switch(evt){
      case 'init':
        mqtt.onInit = optional(success, function(){console.debug("success");});
        mqtt.onInitError = optional(fail, function(){console.log("fail");});
      break;
      case 'connect':
        mqtt.onConnect = optional(success, function(){console.debug("success");});
        mqtt.onConnectError = optional(fail, function(){console.log("fail");});
      break;
      case 'disconnect':
        mqtt.onDisconnect = optional(success, function(){console.debug("success");});
        mqtt.onDisconnectError = optional(fail, function(){console.log("fail");});
      break;
      case 'reconnect':
        mqtt.onReconnect = optional(success, function(){console.debug("success");});
        mqtt.onReconnectError = optional(fail, function(){console.log("fail");});
      break;
      case 'publish':
        mqtt.onPublish = optional(success, function(){console.debug("success");});
        mqtt.onPublishError = optional(fail, function(){console.log("fail");});
      break;
      case 'subscribe':
        mqtt.onSubscribe = optional(success, function(){console.debug("success");});
        mqtt.onSubscribeError = optional(fail, function(){console.log("fail");});
      break;
      case 'unsubscribe':
        mqtt.onUnsubscribe = optional(success, function(){console.debug("success");});
        mqtt.onUnsubscribeError = optional(fail, function(){console.log("fail");});
      break;
      case 'message':
        mqtt.onMessage = optional(success, function(){console.debug("success");});
      break;
      case 'delivered':
        mqtt.onDelivered = optional(success, function(){console.debug("delivered");});
      break;
      case 'offline':
        mqtt.onOffline = optional(success, function(){console.log("offline");});
      break;
    }
  },

  connect: function(){
    if (mqtt.host == null){
      console.error("You have to call init before you connect");
      return;
    }
    mqtt._connect(
      function(success){
        console.debug("MQTT connected.");
        mqtt._resendCached();
        mqtt.onConnect();
      },
      function(err) {
        console.debug("MQTT connecting failed. " + err);
        mqtt.onConnectError();
      }
    )
  },

  _connect: function(success, error){
    cordova.exec(success, error, "MQTTPlugin", "connect", [mqtt.host, mqtt.port, mqtt.options]);
  },

  _reconnect: function(){
    mqtt.disconnect();
    console.debug("Trying to Reconnect...");
    mqtt._connect(
      function connectSuccess(){
        console.log("(re)Connected Again");
        mqtt._resendCached();
        mqtt.onReconnect();
      },
      function connectError(){
        console.debug("Next try in " + mqtt.reconnectInterval + " seconds.");
        setTimeout(mqtt.onOffline, mqtt.reconnectInterval * 1000);
        mqtt.onReconnectError();
      }
    );
  },

  disconnect: function(){
    cordova.exec(
      function(success){
        console.log("Disconnected.");
        mqtt.onDisconnect();
      },
      function(err) {
        mqtt.onDisconnectError();
      },
      "MQTTPlugin", "disconnect", []);
  },

  publish: function(options, success, fail){
    success = success || function(){};
    fail = fail || function(){};
    var topic = (isset(options.topic)) ? options.topic : "public";
    var message = (isset(options.message)) ? options.message : "";
    var qos = (isset(options.qos)) ? options.qos : 0;
    var retain = (isset(options.retain)) ? options.retain : false;

    if (mqtt.offlineCaching && mqtt.cache != null){
      console.log("Cache Publishing " + message);
      mqtt.cache.transaction(function(tx){
        tx.executeSql("INSERT INTO cache(topic, message, qos, retain, sending) VALUES(?,?,?,?,?)", [topic, message, qos, retain, 0],
          function insertSuccess(tx, res){
            mqtt._publishCached(tx);
          },
          function insertError(tx, err){
            console.error("Caching failed: ", err);
            return false;
          }
        );
      },
      function transactionError(err){
        console.error("Caching failed: ", err);
        return false;
      });
    } else {
      console.debug("Direct Publishing " + message);
      mqtt._publish(null, topic, message, qos, retain,
        function(message){
          mqtt.onPublish(message);
          success(message);
        },
        function(err) {
          console.error("Direct publishing failed: ", err);
          mqtt.onPublishError(err, null);
          fail(err);
        }
      );
    }
  },

  _resendCached: function(){
    if (mqtt.offlineCaching){
      mqtt.cache.transaction(function(tx){mqtt._publishCached(tx)});
    }
  },

  _publishCached: function(tx){
    if (!mqtt.isOnline()) {
      return;
    }
    tx.executeSql("SELECT * FROM cache WHERE sending = 0 ORDER BY id", [],
      function selectSuccess(tx, res) {
        console.debug("Found " + res.rows.length + " cached Messages");
        for (var i = 0; i < res.rows.length; i++) {
          (function(i, tx) {
            var message = res.rows.item(i);
            console.debug("Publishing: " + message.id +"| Topic:"+ message.topic +"| Message:"+ message.message +"| QOS:"+ message.qos +"| Retain:"+ message.retain);
            tx.executeSql("UPDATE cache SET sending = 1 WHERE id = ? AND sending = 0", [message.id],
              function updateSuccess(tx, res){
                console.debug("locked Message " + message.id);
                mqtt._publish(message.id, message.topic, message.message, message.qos, message.retain,

                  function publishSuccess(message){
                    var id = message.cacheId;
                    console.debug("Message " + id + " published");
                    mqtt.cache.transaction(
                      function(tx){
                        console.debug("Deleting Message " + id + " from cache");
                        tx.executeSql("DELETE FROM cache WHERE id = ?", [id],
                          function deleteSuccess(tx, res){
                            console.debug("Deleted Message " + id + " from cache");
                          },
                          function deleteError(err){
                            console.error("DELETE Message. Error: "+ err);
                            return false;
                          }
                        );
                      },
                      function transactionError(error){
                        console.error("INSERT TRANSACTION error: " + error);
                        return false;
                      }
                    );
                    delete(message.cacheId);
                    mqtt.onPublish(message);
                  },
                  function publishError(result){
                    console.error("publishing failed : " + result.id );
                    mqtt.cache.transaction(
                      function(tx){
                        console.debug("resetting lock on " + result.id );
                        tx.executeSql("UPDATE cache SET sending = 0 WHERE id = ?", [result.id], function(tx, res){
                          console.debug("UPDATE lock resetted on " + result.id );
                        }, function(error){
                          console.error("UPDATE lock NOT resetted on " + result.id );
                          return false;
                        });
                      }
                    );
                    mqtt.onPublishError(result.error, result.id);
                  }
                );
              },
              function updateError(error){
                console.error("UPDATE error: " + error);
              }
            );
          })(i, tx);
        }
      },
      function selectError(err){
        console.error("SELECT error: " + err);
        return false;
      }
    );
  },

  _publish: function(id, topic, message, qos, retain, success, error){
      cordova.exec(success, error, "MQTTPlugin", "publish", [id, topic, message, qos, retain]);
  },

  subscribe: function(options){ //topic, qos){
    var topic = (isset(options.topic)) ? options.topic : "public";
    var qos = (isset(options.qos)) ? options.qos : 0;
    console.debug("call subscribe on topic " + topic);
    cordova.exec(
      function(success){
        console.debug("subscribe success");
        mqtt.onSubscribe();
      },
      function(err) {
        console.error("subscribe subscribe error");
        mqtt.onSubscribeError();
      },
      "MQTTPlugin", "subscribe", [topic, qos]);
  },

  unsubscribe: function (options){ //topic){
    var topic = (isset(options.topic)) ? options.topic : "public";
    console.debug("call unsubscribe on topic " + topic);
    cordova.exec(
      function(success){
        console.debug("unsubscribe success");
        mqtt.onUnsubscribe();
      },
      function(err) {
        console.error("unsubscribe error");
        mqtt.onUnsubscribeError();
      },
      "MQTTPlugin", "unsubscribe", [topic]);
  },

  onInit: function(){
    console.debug("onInit");
  },
  onInitError: function(){
    console.error("onInitError");
  },

  onConnect: function(){
    console.debug("onConnect");
  },
  onConnectError: function(){
    console.error("onConnectError");
  },

  onReconnect: function(){
    console.debug("onReconnect");
  },
  onReconnectError: function(){
    console.error("onReconnectError");
  },

  onDisconnect: function(){
    console.debug("onDisconnect");
  },
  onDisconnectError: function(){
    console.debug("onDisconnectError");
  },

  onPublish: function(cacheId){
    console.debug("onPublish " + cacheId);
  },
  onPublishError: function(error, id){
    console.debug("onPublishError " + id + ": ", error );
  },

  onSubscribe: function(){
    console.debug("onSubscribe");
  },
  onSubscribeError: function(){
    console.debug("onSubscribeError");
  },

  onUnsubscribe: function(){
    console.debug("onUnsubscribe");
  },
  onUnsubscribeError: function(){
    console.debug("onUnsubscribeError");
  },

  onMessage: function(topic, message, packet){
    console.debug("onMessage");
  },
  onMessageError: function(topic, message, packet){
    console.debug("onMessageError");
  },

  onDelivered: function(){
    console.debug("onDelivered");
  },

  onOnline: function(){
    console.debug("Hi i am online");
  },
  onOffline: function(){
    mqtt._reconnect();
  },

  onError: function(){
    console.debug("onError");
  },

  showCache: function(){
    mqtt.cache.readTransaction(function(tx){
      tx.executeSql("SELECT * FROM cache ORDER BY id", [],
        function(tx, res){
          console.debug("BEGIN");
          for (var i = 0; i < res.rows.length; i++){
            //(function(i, tx){
            var message = res.rows.item(i);
            console.debug(message.id +" | "+ message.topic +" | "+ message.message +" | "+ message.qos +" | "+ message.retain + " | " + message.sending);
          }
          console.debug("END");
        }
      );
    });
  },

  isOnline: function(){
    var states = {};
    states[Connection.UNKNOWN]  = 'Unknown connection';
    states[Connection.ETHERNET] = 'Ethernet connection';
    states[Connection.WIFI]     = 'WiFi connection';
    states[Connection.CELL_2G]  = 'Cell 2G connection';
    states[Connection.CELL_3G]  = 'Cell 3G connection';
    states[Connection.CELL_4G]  = 'Cell 4G connection';
    states[Connection.CELL]     = 'Cell generic connection';
    states[Connection.NONE]     = 'No network connection';
    console.debug("Network Connection is: "+ states[navigator.connection.type]);
    return (navigator.connection.type != Connection.NONE);
  }

}

function optional(obj, def){
  return (isset(obj))  ? obj : def;
}

function required(obj){
  if (!isset(obj)){
    console.error(key + " is required but not set");
  }
  return obj;
}

function isset(obj){
  return (typeof obj != 'undefined');
}
module.exports = mqtt;
