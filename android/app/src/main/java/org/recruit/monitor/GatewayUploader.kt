package org.recruit.monitor

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/** Runtime-only credentials. Bounded queue/retries and original timestamps. */
class GatewayUploader(baseUrl: String, private val gatewayId: String,
 private val bearerToken: String, private val onStatus: (String) -> Unit) {
 private val endpoint = URL(baseUrl.trimEnd('/') + "/api/ingest")
 private val jobs = ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,
  ArrayBlockingQueue<Runnable>(15),ThreadPoolExecutor.DiscardOldestPolicy())
 init {
  val base = URL(baseUrl)
  require(base.protocol == "https" && base.host.isNotBlank() && base.userInfo == null &&
   base.query == null && base.ref == null && (base.path == "" || base.path == "/")) { "Use an HTTPS server origin" }
  require(Regex("G0[1-5]").matches(gatewayId) && bearerToken.length >= 32)
 }
 fun submit(slotId: String, deviceId: String, bpm: Int?, timestamp: Long = System.currentTimeMillis()) {
  require(Regex("R(0[1-9]|1[0-5])").matches(slotId) && Regex("[a-zA-Z0-9_-]{4,64}").matches(deviceId))
  require(bpm == null || bpm in 25..240)
  val reading = JSONObject().put("id",slotId).put("device_id",deviceId).put("timestamp",timestamp)
  if (bpm == null) reading.put("state","DISCONNECTED") else reading.put("hr",bpm)
  enqueue(JSONArray().put(reading), timestamp)
 }
 fun heartbeat() = enqueue(JSONArray(),System.currentTimeMillis())
 private fun enqueue(readings: JSONArray, timestamp: Long) {
  if (jobs.isShutdown) return
  val body = JSONObject().put("gateway",gatewayId).put("readings",readings).toString()
  jobs.execute {
   for (attempt in 0..2) {
    if (Thread.currentThread().isInterrupted || System.currentTimeMillis()-timestamp > 12000) {
     onStatus("Upload expired; awaiting a new measurement"); return@execute
    }
    var connection: HttpURLConnection? = null
    try {
     connection = endpoint.openConnection() as HttpURLConnection
     connection.instanceFollowRedirects = false
     connection.requestMethod = "POST"
     connection.connectTimeout = 3000; connection.readTimeout = 3000; connection.doOutput = true
     connection.setRequestProperty("Content-Type","application/json")
     connection.setRequestProperty("Authorization","Bearer " + bearerToken)
     connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
     val code = connection.responseCode
     if (code == 200) {
      val result = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
      onStatus(if (result.optInt("accepted",-1) == readings.length()) "Server acknowledged" else
       "Not accepted: check mapping / timestamp; duplicate retries are ignored")
      return@execute
     }
     if (code != 429 && code < 500) { onStatus("Upload rejected (HTTP $code); check configuration"); return@execute }
    } catch (_: Exception) {
     if (Thread.currentThread().isInterrupted) return@execute
    } finally { connection?.disconnect() }
    if (attempt < 2) try { Thread.sleep(500L * (attempt+1)) } catch (_: InterruptedException) { return@execute }
   }
   onStatus("Upload unavailable after 3 attempts; waiting for new data")
  }
 }
 fun shutdown() { jobs.shutdownNow() }
}

