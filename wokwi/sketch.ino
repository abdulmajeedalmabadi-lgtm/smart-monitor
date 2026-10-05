#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include <esp_system.h>
#if __has_include("config.h")
#include "config.h"
#else
#include "config.example.h"
#endif
#include "root_ca.h"

// Two simulated sensor confirmations. Both switches right => water event.
constexpr int WAVE_PIN=18, CONFIRM_PIN=19, BATTERY_PIN=34, LED_PIN=23;
constexpr unsigned long INTERVAL=20000, RETRY=10000;
String bootId,pending;
uint32_t sequence=0;
unsigned long nextSend=0;
bool lastWater=false,monitoringEnabled=true,configured=false;

bool detected(){return digitalRead(WAVE_PIN)==LOW && digitalRead(CONFIRM_PIN)==LOW;}
void makeSample(bool water){
  time_t utc=time(nullptr);struct tm tmUtc;gmtime_r(&utc,&tmUtc);
  char timestamp[25];strftime(timestamp,sizeof(timestamp),"%Y-%m-%dT%H:%M:%SZ",&tmUtc);
  JsonDocument doc;
  doc["deviceId"]=DEVICE_ID;doc["sampleId"]=bootId+"-"+String(sequence++);
  doc["source"]="wokwi";doc["waterDetected"]=water;
  doc["batteryPercent"]=int(analogRead(BATTERY_PIN)*100L/4095);
  doc["rssi"]=constrain(WiFi.RSSI(),-120,0);doc["timestamp"]=timestamp;
  pending="";serializeJson(doc,pending);
  lastWater=water;
}
void setup(){
  Serial.begin(115200);
  pinMode(WAVE_PIN,INPUT_PULLUP);pinMode(CONFIRM_PIN,INPUT_PULLUP);pinMode(LED_PIN,OUTPUT);
  analogReadResolution(12);
  char id[33];snprintf(id,sizeof(id),"%08lx%08lx%08lx%08lx",(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random(),(unsigned long)esp_random());bootId=id;
  configured=String(API_URL).startsWith("https://")&&String(API_URL).indexOf("PUBLIC-DOMAIN")<0&&strlen(DEVICE_KEY)>=32&&strlen(ROOT_CA)>100;
  if(!configured){Serial.println("Setup required: config.h API_URL + device key, and generated root_ca.h. See README.");return;}
  WiFi.mode(WIFI_STA);WiFi.begin("Wokwi-GUEST","",6);
  Serial.println("Connecting to Wokwi Wi-Fi...");
  configTime(0,0,"pool.ntp.org","time.google.com");
}
void loop(){
  if(!configured){delay(1000);return;}
  const bool water=detected();digitalWrite(LED_PIN,water&&monitoringEnabled?HIGH:LOW);
  if(WiFi.status()!=WL_CONNECTED){delay(500);return;}
  if(time(nullptr)<1700000000){Serial.println("Waiting for NTP clock...");delay(1000);return;}
  // Keep a failed request byte-for-byte identical for safe idempotent retries.
  if((long)(millis()-nextSend)<0&&(pending.length()||water==lastWater)){delay(50);return;}
  if(!pending.length())makeSample(water);
  WiFiClientSecure tls;tls.setCACert(ROOT_CA);tls.setHandshakeTimeout(30);
  HTTPClient http;http.setConnectTimeout(15000);http.setTimeout(60000);
  if(!http.begin(tls,API_URL)){Serial.println("HTTPS setup failed");nextSend=millis()+RETRY;return;}
  http.addHeader("Content-Type","application/json");
  http.addHeader("Authorization",String("Bearer ")+DEVICE_KEY);
  const int code=http.POST(pending);
  Serial.printf("Telemetry HTTP %d\n",code);
  if(code==200||code==201){
    JsonDocument reply;auto error=deserializeJson(reply,http.getString());
    if(!error&&reply["accepted"]==true){monitoringEnabled=reply["monitoringEnabled"]|true;pending="";Serial.println("Accepted by database; check the phone dashboard.");nextSend=millis()+INTERVAL;}
    else nextSend=millis()+RETRY;
  }else{
    // 400 means the stored sample is invalid/expired; 409 means an ID conflict.
    if(code==400||code==409)pending="";
    if(code==401||code==403)Serial.println("Check IOT_API_KEY and DEVICE_ID; never use the dashboard password.");
    if(code<0)Serial.println("Check public URL, current CA certificate and NTP clock; retrying.");
    nextSend=millis()+RETRY;
  }
  http.end();delay(50);
}
