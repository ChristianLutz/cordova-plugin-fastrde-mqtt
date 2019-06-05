package de.fastr.cordova.plugin;

import org.apache.cordova.CordovaPlugin;
import org.apache.cordova.CallbackContext;
import org.apache.cordova.PluginResult;
import org.apache.cordova.CordovaResourceApi;
import org.apache.cordova.CordovaWebView;
import org.apache.cordova.LOG;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.InputStream;
import java.math.BigInteger;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

import android.net.Uri;
import android.content.Context;

import org.eclipse.paho.client.mqttv3.MqttAsyncClient;
import org.eclipse.paho.client.mqttv3.IMqttActionListener;
import org.eclipse.paho.client.mqttv3.IMqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.IMqttToken;
import org.eclipse.paho.client.mqttv3.MqttDeliveryToken;
import org.eclipse.paho.client.mqttv3.MqttCallback;
import org.eclipse.paho.client.mqttv3.MqttConnectOptions;
import org.eclipse.paho.client.mqttv3.MqttException;
import org.eclipse.paho.client.mqttv3.MqttSecurityException;
import org.eclipse.paho.client.mqttv3.MqttTopic;
import org.eclipse.paho.client.mqttv3.MqttMessage;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;

public class MQTTPlugin extends CordovaPlugin implements MqttCallback {

  private final String TAG = "MQTTPlugin";
  private MqttAsyncClient client;
  private MqttConnectOptions connOpts;

  public void deliveryComplete(IMqttDeliveryToken token) {
    final CordovaWebView webView_ = webView;
    cordova.getActivity().runOnUiThread(new Runnable() {
      public void run() {
        webView_.loadUrl("javascript:mqtt.onDelivered();");
      }
    });
  }

  public void connectionLost(Throwable cause) {
    LOG.d(TAG, "Callback - Connection lost", cause);
    final String reason = getReason(cause);
    final CordovaWebView webView_ = webView;
    cordova.getActivity().runOnUiThread(new Runnable() {
      public void run() {
        webView_.loadUrl(String.format("javascript:mqtt.onOffline('%s');", reason));
      }
    });
  }

  private String getReason(Throwable cause) {
    String reason = "UNKNOWN";
    if (cause != null && cause.getMessage() != null) {
      reason = cause.getMessage();
    }
    return reason;
  }

  public void messageArrived(String topic, MqttMessage mqttMessage) throws Exception{
    JSONObject message = new JSONObject();
    message.put("topic", topic);
    message.put("message", new String(mqttMessage.getPayload()));
    message.put("qos", mqttMessage.getQos());
    message.put("retain", mqttMessage.isRetained());
    final String jsonString = message.toString();
    final CordovaWebView webView_ = webView;
    cordova.getActivity().runOnUiThread(new Runnable() {
      public void run() {
        webView_.loadUrl(String.format("javascript:mqtt.onMessage('%s');", jsonString));
      }
    });
    LOG.d(TAG, "mqtt.onMessage(%s)", message);
  }

  public boolean execute(String action, JSONArray args, final CallbackContext callbackContext) throws JSONException {
    // IsConnected
    if ("isConnected".equals(action)) {
      isConnected(callbackContext);
      return true;
    } //Connect
    else if ("connect".equals(action)) {
      String host = args.getString(0);
      int port = 1883;
      if (args.length() > 1){
        port = args.getInt(1);
      }
      JSONObject options = null;
      if (args.length() > 2){
        options = args.getJSONObject(2);
      }else{
        options = new JSONObject();
      }
      LOG.d(TAG, "%s : %d", host, port);
      connect(host, port, options, callbackContext);
      return true;
    } //Disconnect
    else if ("disconnect".equals(action)) {
      disconnect(callbackContext);
      return true;
    } //Publish
    else if ("publish".equals(action)) {
      Integer id = args.optInt(0);
      String topic = args.getString(1);
      String msg = args.getString(2);
      int qos = args.getInt(3);
      boolean retained = args.getBoolean(4);
      publish(id, topic, msg, qos, retained, callbackContext);
      return true;
    } //Subscribe
    else if ("subscribe".equals(action)) {
      String topic = args.getString(0);
      int qos = args.getInt(1);
      subscribe(topic, qos, callbackContext);
      return true;
    } //Unsubscribe
    else if ("unsubscribe".equals(action)) {
      String topic = args.getString(0);
      unsubscribe(topic, callbackContext);
      return true;
    }
    return false;
  }

  private void connect(final String host, final int port, final JSONObject options, final CallbackContext callbackContext){
    LOG.d(TAG, "Try to connect");
    final Context context = cordova.getActivity().getApplicationContext();
    final MQTTPlugin self = this;

    cordova.getThreadPool().execute(new Runnable() {
      public void run() {
        LOG.d(TAG, "Start connecting thread");
        String clientId = "mqtt-client-" + MqttAsyncClient.generateClientId();
        String protocol = "tcp";
        try {
          if (options.has("ssl") && options.getBoolean("ssl")) {
            protocol = "ssl";
          }

          if (options.has("clientId")) {
            String optClientId = options.getString("clientId");
            if (optClientId != null && !"null".equals(optClientId)) {
              clientId = options.getString("clientId");
            }
          }
          final MemoryPersistence persistence = new MemoryPersistence();
          String serverUri = protocol + "://" + host + ":" + port;

          connOpts = new MqttConnectOptions();
          connOpts.setCleanSession(true);
          // connOpts.setAutomaticReconnect(true);

          if (options.has("username")) connOpts.setUserName(options.getString("username"));
          if (options.has("password")) connOpts.setPassword(options.getString("password").toCharArray());
          if (options.has("keepAlive")) connOpts.setKeepAliveInterval(options.getInt("keepAlive"));
          if (options.has("cleanSession")) connOpts.setCleanSession(options.getBoolean("cleanSession"));
          if (options.has("protocol")) connOpts.setMqttVersion(options.getInt("protocol"));
          if (options.has("will")){
            JSONObject will = options.getJSONObject("will");
            connOpts.setWill(options.getString("topic"), options.getString("message").getBytes(), options.getInt("qos"), options.getBoolean("retain"));
          }
          LOG.d(TAG, "connect to %s:%d", host, port);
          LOG.d(TAG, "=================");
          LOG.d(TAG, "clientId: %s", clientId);
          LOG.d(TAG, "userName: %s", connOpts.getUserName());
          LOG.d(TAG, "password: %s", connOpts.getPassword());
          LOG.d(TAG, "keepAliveInterval: %s", connOpts.getKeepAliveInterval());
          LOG.d(TAG, "cleanSessionFlag: %s", (connOpts.isCleanSession()?"true":"false"));
          LOG.d(TAG, "protocolLevel: %s", connOpts.getMqttVersion());
          LOG.d(TAG, "ssl: %s", (protocol.equals("ssl")?"true":"false"));

          client = new MqttAsyncClient(serverUri, clientId, persistence);
          client.setCallback((MqttCallback) self);
          client.connect(connOpts, null, new IMqttActionListener() {
            @Override
            public void onSuccess(IMqttToken asyncActionToken) {
              try {
                LOG.d(TAG, "Connected");
                JSONObject ret = new JSONObject();
                ret.put("status", 1);
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
              } catch (JSONException e) {
                LOG.d(TAG, "Exception", e);
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
              }
            }
            @Override
            public void onFailure(IMqttToken asyncActionToken, Throwable exception) {
              try {
                JSONObject ret = new JSONObject();
                ret.put("status", 0);
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, ret));
              } catch (JSONException e) {
                LOG.d(TAG, "Exception", e);
                callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
              }
            }
          });
        } catch(Exception e1) {
          LOG.d(TAG, "Exception", e1);
        }
      }
    });
  }

  private void disconnect(final CallbackContext callbackContext){
    cordova.getThreadPool().execute(new Runnable() {
      public void run() {
        try {
          if (client != null && client.isConnected()) {
            LOG.d(TAG, "Disconnect connected client");
            client.disconnect(30, null, new IMqttActionListener() {
              @Override
              public void onSuccess(IMqttToken asyncActionToken) {
                try {
                  client.close();
                  JSONObject ret = new JSONObject();
                  ret.put("status", 0);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
                } catch (Exception e) {
                  LOG.d(TAG, "Exception", e);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
                }
              }
              @Override
              public void onFailure(IMqttToken asyncActionToken, Throwable exception) {
                try {
                  client.close();
                  JSONObject ret = new JSONObject();
                  ret.put("status", 0);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, ret));
                } catch (Exception e) {
                  LOG.d(TAG, "Exception", e);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
                }
              }
            });
          }
          else if (client != null) {
            LOG.d(TAG, "Close unconnected client");
            client.close();
          }

          try {
            JSONObject ret = new JSONObject();
            ret.put("status", 0);
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
          } catch (JSONException e) {
            LOG.d(TAG, "Exception", e);
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
          }
        } catch(Exception e2) {
          LOG.d(TAG, "Exception", e2);
        }
      }
    });
  }

  private void isConnected(final CallbackContext callbackContext) {
    cordova.getThreadPool().execute(new Runnable() {
      public void run() {
        try {
          boolean status = client != null && client.isConnected();
          LOG.d(TAG, "Mqtt connected status " + status);
          if (status) {
            JSONObject ret = new JSONObject();
            ret.put("status", 1);
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
          }
          JSONObject ret = new JSONObject();
          ret.put("status", 0);
          LOG.d(TAG, "Unconnected");
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, ret));
        } catch(JSONException e1) {
          LOG.d(TAG, "Exception", e1);
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e1.getMessage()));
        } catch(Exception e2) {
          LOG.d(TAG, "Exception", e2);
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e2.getMessage()));
        }
      }
    });
  }

  private void publish(final Integer id, final String topic, final String msg, final int qos, final boolean retained, final CallbackContext callbackContext){
    LOG.d(TAG, "publish " + topic + " | " + msg);
    cordova.getThreadPool().execute(new Runnable() {
      public void run() {
        try {
          long startTime = System.currentTimeMillis();
          synchronized(client) {
            client.publish(topic, msg.getBytes(), qos, retained, null, new IMqttActionListener() {
              @Override
              public void onSuccess(IMqttToken asyncActionToken) {
                LOG.d(TAG, "Time: %d[ms]", (System.currentTimeMillis()-startTime));
                try {
                  JSONObject ret = new JSONObject();
                  if (id != null){
                    ret.put("cacheId", id);
                  }
                  ret.put("topic", topic);
                  ret.put("message", msg);
                  ret.put("qos", qos);
                  ret.put("retain", retained);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
                } catch (JSONException e) {
                  LOG.d(TAG, "Exception", e);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
                }
              }

              @Override
              public void onFailure(IMqttToken asyncActionToken, Throwable exception) {
                try {
                  JSONObject err = new JSONObject();
                  err.put("id", id);
                  err.put("error", exception.getMessage());
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, err));
                } catch (JSONException e) {
                  LOG.d(TAG, "Exception", e);
                  callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
                }
              }
            });
          }
        } catch (Exception e) {
          LOG.d(TAG, "Exception", e);
          try {
            JSONObject err = new JSONObject();
            err.put("id", id);
            err.put("error", e.getMessage());
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, err));
          } catch (JSONException e1) {
            LOG.d(TAG, "Exception", e1);
            callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e1.getMessage()));
          }
        }
      }
    });
  }

  private void subscribe(final String topic, final int qos, final CallbackContext callbackContext){
    cordova.getThreadPool().execute(new Runnable() {
      public void run() {
        try {
          client.subscribe(topic, qos);
          JSONObject ret = new JSONObject();
          ret.put("topic", topic);
          ret.put("qos", qos);
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
        } catch(MqttException e) {
          LOG.d(TAG, "Exception", e);
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, e.getMessage()));
        } catch(JSONException jsonException) {
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, jsonException.getMessage()));
        }
      }
    });
  }

  private void unsubscribe(final String topic, final CallbackContext callbackContext){
    cordova.getThreadPool().execute(new Runnable() {
      public void run() {
        try {
          client.unsubscribe(topic);
          JSONObject ret = new JSONObject();
          ret.put("topic", topic);
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.OK, ret));
        } catch(MqttException e) {
          LOG.d(TAG, "Exception", e);
          callbackContext.error(e.getMessage());
        } catch(JSONException jsonException) {
          callbackContext.sendPluginResult(new PluginResult(PluginResult.Status.ERROR, jsonException.getMessage()));
        }
      }
    });
  }
}
