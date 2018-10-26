# cordova-plugin-fastrde-mqtt

## installation notes
Using cordova android > 7 please read this.
https://gist.github.com/joeljeske/68121fa6d643e0937f50458d0172e16e

## Dev Notes
With the beginning of 1.4.0-SNAPSHOT a lot has changed.
- Switch from blocking MqttClient to MqttAsyncClient, even with a lock the blocking code didn't work reliable.
- Replaced the direct cache publishing send with an interval cache publishing. There are two reasons for this
  1. Sometimes messages will be created faster than they may processed. In this case we might run into MqttException.REASON_CODE_MAX_INFLIGHT
  2. If the client is offline the buffer fills up with the still incomming messages. If the client goes online, now it isn't possible send all cached messages at once.
  Note: of course there is one downside of the current implemantation. If you have a perfect connection and only rare data comming in the intervall will create some processing overhead you maybe don't like.
- Reconnect / Error Handling should be improved
- Update paho Lib to version 1.2.0


#### mqtt.init(options)
Initialize the mqtt-client with the given options.
```
    host - borker to connect to [required]
    port - port to connect to [default 1883]
    qos - Quality of Service level[default 0]
    clientId - Unique Identifier for the Client [default cordova_mqtt_<random>]
    username - username for broker authentication [default none]
    password - password for broker authentication [default none]
    ssl - should ssl be used [default false]
    keepAlive - keepAlive sending interval in seconds [default 10]
    timeout - session timeouts after <timeout> seconds [default 30]
    cleanSession - clean Session at disconnect [default true]
    protocol - mqtt protocol level [default 4]
    offlineCaching - should mesages be cached in sqlite before sending [default true]
```
#### mqtt.connect()
connect to the broker with the initial given options.
#### mqtt.disconnect()
disconnect from the broker.
#### mqtt.publish(message)
Send a Message.
```
    topic - topic where the message is send to
    message - payload of the message
    qos - Quality of Service level
    retain - should the message retain in the channel
```
#### mqtt.subscribe(options)
Subscribes to the topic with the given options
```
    topic - topic to subscribe
    qos - Quality of Service of the Subscription
```
#### mqtt.unsubscribe(options)
Subscribes to the topic with the given options
```
    topic - topic to unsubscribe
```
#### mqtt.on(event, success, error)
set callback functions for the given event.
```
    event - could be
      "init":

      "connect":
        success(status)
        error(errorMessage)
      "disconnect":
        success(status)
        error(errorMessage)
      "publish":
        success(message)
        error(errorMessage)
      "subscribe":
        success(subscribtion)
        error(errorMessage)
      "unsubscribe":
        success(topic)
        error(errorMessage)
     "message":
        success(message)

    success - callback that get called on success of the event
    error - callback that get called on error of the event
```
#### mqtt.will(message)
```
    topic - topic where the last will is send to on disconnect
    message - payload of the message
    qos - Quality of Service level
    retain - should the message retain in the channel
```
