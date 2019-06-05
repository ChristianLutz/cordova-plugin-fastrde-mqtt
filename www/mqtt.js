var mqtt={
  debug_deleteTable: false,
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
  reconnectTime: 10000,
  reconnectTimeout: null,
  sendCacheTime: 1000,
  sendCacheInterval: undefined,
  sendAmountMessage: 0, // Remove after this has been fixed https://github.com/eclipse/paho.mqtt.java/issues/551

  init: function(options){
    mqtt.host = required(options.host);
    mqtt.port = optional(options.port, 1883);
    mqtt.options = {
      qos  : optional(options.qos, 0),
      clientId : optional(options.clientId, null),
      username : optional(options.username, null),
      password : optional(options.password, null),
      ssl : optional(options.ssl, false),
      keepAlive : optional(options.keepAlive, 20),
      timeout : optional(options.timeout, 30),
      cleanSession : optional(options.cleanSession, true),
      protocol : optional(options.protocol, 4)
    };
    mqtt.offlineCaching = optional(options.offlineCaching, true);

    if (mqtt.offlineCaching){
      mqtt.cache = window.sqlitePlugin.openDatabase({name: "mqttcache.db", location: 'default'},
        function(db) { // Is this a good idea, see https://github.com/litehelpers/Cordova-sqlite-storage/issues/736
          db.executeSql("PRAGMA synchronous=OFF", [],
            function(){
            },
            function(error){
              console.log("PRAGMA error: ", error);
              return false;
            }
          );
          if (mqtt.debug_deleteTable){
            db.transaction(function (tx) {
              tx.executeSql("DROP TABLE cache;",
                function createSuccess(tx, res) {
                  console.log("MQTT - Debug Mode: Cache DB dropped");
                }
              );
              mqtt.debug_deleteTable = false;
            });
          }
          db.transaction(function (tx) {
            tx.executeSql("CREATE TABLE IF NOT EXISTS cache(id INTEGER PRIMARY KEY AUTOINCREMENT, topic TEXT, message INT, qos INT, retain INT, sending INT)",[],
              function createSuccess(tx, res){
                console.log("MQTT - Cache DB created");
                document.addEventListener("online", mqtt.onOnline, false);
                document.addEventListener("offline", mqtt.onOffline, false);
                mqtt.onInit();
              },
              function createError(){
                console.error("MQTT - Cache DB creation error");
                mqtt.onInitError();
                return false;
              });
            },
            function transactionError(error) {
              console.error("MQTT - Cache DB transaction error: " + JSON.stringify(error));
              mqtt.onInitError();
              return false;
            }
          );
          // If the App gets closed and some messages are still sending, the sending status needs to be reset
          // otherwise this messages won't ever be deleted from the cache db.
          db.transaction(function (tx) {
            tx.executeSql("UPDATE cache SET sending = 0 WHERE sending = 1", [],
              function createSuccess(tx, res){
                console.log("MQTT - Resetting old sending status");
              },
              function createError(){
                console.error("MQTT - Failed to reset sending status");
                return false;
              });
            },
            function transactionError(error) {
              console.error("MQTT - Cache DB transaction error: " + JSON.stringify(error));
              mqtt.onInitError();
              return false;
            }
          );
          // Print number of elements in cache
          db.transaction(function (tx) {
            tx.executeSql("SELECT COUNT(*) as amount FROM cache", [],
              function createSuccess(tx, res){
                console.log("MQTT - " + res.rows.item(0).amount + " pending cached messages");
              });
            }
          );
        },
        function openDBError(err) {
          console.error('MQTT - Cache DB open database error: ' + JSON.stringify(err));
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
      console.error("MQTT - You have to call init before you connect");
      return;
    }
    mqtt._connect(
      function(success){
        console.debug("MQTT - Connected.");
        mqtt.sendAmountMessage = 0;
        mqtt._sendCacheInterval();
        mqtt.onConnect();
      },
      function(err) {
        console.debug("MQTT - Connecting failed. " + err);
        mqtt.onConnectError();
      }
    )
  },

  _connect: function(success, error){
    cordova.exec(success, error, "MQTTPlugin", "connect", [mqtt.host, mqtt.port, mqtt.options]);
  },

  _isConnected: function(success, error){
    cordova.exec(success, error, "MQTTPlugin", "isConnected", []);
  },

  _reconnect: function(){
    if (!mqtt.reconnectTimeout) {
      mqtt._clearCacheInterval();
      mqtt.reconnectTimeout = setTimeout(() => {
        mqtt._isConnected(
          function isAlreadyConnected() {
            mqtt.reconnectTimeout = null;
            console.log("MQTT - Is already connected again");
            mqtt._sendCacheInterval();
          },
          function notConnected() {
            mqtt._disconnect( // cleanUp used resources
              function successDisconnect() {
                console.debug("MQTT - Trying to Reconnect...");
                mqtt._connect(
                  () => {
                    mqtt.reconnectTimeout = null;
                    console.log("MQTT - Reconnected Again");
                    mqtt.sendAmountMessage = 0;
                    mqtt._sendCacheInterval();
                    mqtt.onReconnect();
                  },
                  () => mqtt._triggerReconnect()
                );
              },
              () => mqtt._triggerReconnect()
            );
          }
        );
      }, mqtt.reconnectTime);
    }
  },

  _clearCacheInterval() {
    if (mqtt.sendCacheInterval) {
      mqtt.sendCacheInterval = clearInterval(mqtt.sendCacheInterval);
    }
  },

  _sendCacheInterval() {
    if (!mqtt.sendCacheInterval) {
      mqtt.sendCacheInterval = setInterval(() => mqtt._resendCached(), mqtt.sendCacheTime);
    }
  },

  _triggerReconnect() {
    mqtt.reconnectTimeout = null;
    console.debug("MQTT - Next try in " + mqtt.reconnectTime + " seconds.");
    mqtt.onOffline();
    mqtt.onReconnectError();
  },

  disconnect: function() {
    mqtt._clearCacheInterval();
    mqtt._disconnect(
      function(success){
        console.log("MQTT - Disconnected.");
        mqtt.onDisconnect();
      },
      function(err) {
        mqtt.onDisconnectError();
      }
    );
  },

  _disconnect: function(success, fail) {
    cordova.exec(success, fail, "MQTTPlugin", "disconnect", []);
  },

  publish: function(options, success, fail) {
    success = success || function(){};
    fail = fail || function(){};
    var topic = (isset(options.topic)) ? options.topic : "public";
    var message = (isset(options.message)) ? options.message : "";
    var qos = (isset(options.qos)) ? options.qos : 0;
    var retain = (isset(options.retain)) ? options.retain : false;

    if (mqtt.offlineCaching && mqtt.cache != null){
      console.debug("MQTT - Add message to cache");
      mqtt.cache.transaction(function(tx){
        tx.executeSql("INSERT INTO cache(topic, message, qos, retain, sending) VALUES(?,?,?,?,?)", [topic, message, qos, retain, 0],
          function insertSuccess(tx, res){
            console.debug("MQTT - Successfully added message to cache");
          },
          function insertError(tx, err){
            console.error("MQTT - Caching failed: ", err);
            return false;
          }
        );
      },
      function transactionError(err){
        console.error("MQTT - Caching failed: ", err);
        return false;
      });
    } else {
      console.debug("MQTT - Direct Publishing " + message);
      mqtt._publish(null, topic, message, qos, retain,
        function(message){
          mqtt.onPublish(message);
          success(message);
        },
        function(err) {
          console.error("MQTT - Direct publishing failed: ", err);
          mqtt.onPublishError(err, null);
          fail(err);
        }
      );
    }
  },

  _resendCached: function(){
    if (mqtt.offlineCaching){
      mqtt.cache.transaction(tx => mqtt._publishCached(tx));
    }
  },

  _publishCached: function(tx){
    tx.executeSql("SELECT * FROM cache WHERE sending = 0 ORDER BY id LIMIT 1", [],
      function selectSuccess(tx, res) {
        var amountToExecute = res.rows.length > 0 ? 1 : 0;
        for (var i = 0; i < amountToExecute && mqtt.sendAmountMessage < 40; i++) {
          (function(i, tx) {
            var message = res.rows.item(i);
            console.debug("MQTT - Try to publishing: " + message.id + "| Topic:"+ message.topic
              + "| Message:" + message.message + "| QOS:"+ message.qos + "| Retain:"+ message.retain);
            mqtt.sendAmountMessage++; // We need to limit the amount of send message at the same time;
            tx.executeSql("UPDATE cache SET sending = 1 WHERE id = ? AND sending = 0", [message.id],
              function updateSuccess(tx, res){
                console.debug("MQTT - Locked Message " + message.id);
                mqtt._publish(message.id, message.topic, message.message, message.qos, message.retain,

                  function publishSuccess(message) {
                    var id = message.cacheId;
                    mqtt.sendAmountMessage--;
                    console.debug("MQTT - Message " + id + " published");
                    mqtt.cache.transaction(
                      function(tx){
                        console.debug("MQTT - Try to deleting Message " + id + " from cache");
                        tx.executeSql("DELETE FROM cache WHERE id = ?", [id],
                          function deleteSuccess(tx, res){
                            console.debug("MQTT - Deleted Message " + id + " from cache");
                          },
                          function deleteError(err){
                            console.error("MQTT - DELETE Message. Error: "+ err);
                            return false;
                          }
                        );
                      },
                      function transactionError(error){
                        console.error("MQTT - INSERT TRANSACTION error: " + error);
                        return false;
                      }
                    );
                    delete(message.cacheId);
                    mqtt.onPublish(message);
                  },
                  function publishError(result) {
                    mqtt.sendAmountMessage--;
                    console.warn("MQTT - Publishing failed : " + result.id  + " " + result.error);
                    mqtt.cache.transaction(
                      function(tx){
                        console.debug("MQTT - Try to resetting lock on " + result.id );
                        tx.executeSql("UPDATE cache SET sending = 0 WHERE id = ?", [result.id], function(tx, res){
                          console.debug("MQTT - UPDATE lock resetted on " + result.id );
                        }, function(error){
                          console.error("MQTT - UPDATE lock NOT resetted on " + result.id );
                          return false;
                        });
                      }
                    );
                    mqtt._reconnect();
                    mqtt.onPublishError(result.error, result.id);
                  }
                );
              },
              function updateError(error){
                console.error("MQTT - UPDATE error: " + error);
              }
            );
          })(i, tx);
        }
      },
      function selectError(err){
        console.error("MQTT - SELECT error: " + err);
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
    console.debug("MQTT - Call subscribe on topic " + topic);
    cordova.exec(
      function(success){
        console.debug("MQTT - Subscribe success");
        mqtt.onSubscribe();
      },
      function(err) {
        console.error("MQTT - Subscribe subscribe error");
        mqtt.onSubscribeError();
      },
      "MQTTPlugin", "subscribe", [topic, qos]);
  },

  unsubscribe: function (options){ //topic){
    var topic = (isset(options.topic)) ? options.topic : "public";
    console.debug("MQTT - Call unsubscribe on topic " + topic);
    cordova.exec(
      function(success){
        console.debug("MQTT - Unsubscribe success");
        mqtt.onUnsubscribe();
      },
      function(err) {
        console.error("MQTT - Unsubscribe error");
        mqtt.onUnsubscribeError();
      },
      "MQTTPlugin", "unsubscribe", [topic]);
  },

  onInit: function(){
    console.debug("MQTT - onInit");
  },
  onInitError: function(){
    console.error("MQTT - onInitError");
  },

  onConnect: function(){
    console.debug("MQTT - onConnect");
  },
  onConnectError: function(){
    console.error("MQTT - onConnectError");
  },

  onReconnect: function(){
    console.debug("MQTT - onReconnect");
  },
  onReconnectError: function(){
    console.error("MQTT - onReconnectError");
  },

  onDisconnect: function(){
    console.debug("MQTT - onDisconnect");
  },
  onDisconnectError: function(){
    console.debug("MQTT - onDisconnectError");
  },

  onPublish: function(cacheId){
    console.debug("MQTT - onPublish " + cacheId);
  },

  onPublishError: function(error, id){
    console.debug("MQTT - onPublishError " + id + ": ", error );
  },

  onSubscribe: function(){
    console.debug("MQTT - onSubscribe");
  },
  onSubscribeError: function(){
    console.debug("MQTT - onSubscribeError");
  },

  onUnsubscribe: function(){
    console.debug("MQTT - onUnsubscribe");
  },
  onUnsubscribeError: function(){
    console.debug("onUnsubscribeError");
  },

  onMessage: function(topic, message, packet){
    console.debug("MQTT - onMessage");
  },
  onMessageError: function(topic, message, packet){
    console.debug("MQTT - onMessageError");
  },

  onDelivered: function(){
    console.debug("MQTT - onDelivered");
  },

  onOnline: function(){
    console.debug("MQTT - Hi i am online");
  },

  onOffline: function(err){
    console.warn("MQTT - On Offline " + err);
    mqtt._reconnect();
  },

  onError: function(){
    console.debug("MQTT - onError");
  },

  showCache: function(){
    mqtt.cache.readTransaction(function(tx){
      tx.executeSql("SELECT * FROM cache ORDER BY id", [],
        function(tx, res){
          console.debug("MQTT - BEGIN");
          for (var i = 0; i < res.rows.length; i++){
            //(function(i, tx){
            var message = res.rows.item(i);
            console.debug(message.id +" | "+ message.topic +" | "+ message.message +" | "+ message.qos +" | "+ message.retain + " | " + message.sending);
          }
          console.debug("MQTT - END");
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
