package org.recruit.monitor

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Opt-in, runtime-provisioned HTTPS transport for the experimental BLE reader.
 * No credentials, MAC addresses, names or health histories are stored on disk.
 * App UI pairing/assignment is deliberately not implemented here.
 */
class GatewayUploader(private val baseUrl: String, private val gatewayId: String,
                      private val bearerToken: String) {
    private val jobs = ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,
        ArrayBlockingQueue<Runnable>(32),ThreadPoolExecutor.DiscardOldestPolicy())
    init {
        require(baseUrl.startsWith("https://")) { "HTTPS is required" }
        require(Regex("G0[1-5]").matches(gatewayId)) { "Invalid gateway" }
        require(bearerToken.isNotBlank()) { "Missing credentials" }
    }
    fun submit(slotId: String, deviceId: String, bpm: Int, timestamp: Long=System.currentTimeMillis()) {
        require(Regex("R(0[1-9]|1[0-5])").matches(slotId) && deviceId.isNotBlank())
        require(bpm in 25..240)
        jobs.execute {
            val connection = URL(baseUrl.trimEnd('/') + "/api/ingest").openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 4000
                connection.readTimeout = 4000
                connection.doOutput = true
                connection.setRequestProperty("Content-Type","application/json")
                connection.setRequestProperty("Authorization","Bearer " + bearerToken)
                val reading = JSONObject().put("id",slotId).put("device_id",deviceId)
                    .put("hr",bpm).put("timestamp",timestamp)
                val body = JSONObject().put("gateway",gatewayId)
                    .put("readings",JSONArray().put(reading)).toString()
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                if (connection.responseCode != 200) {
                    // Intentionally no sensitive reading/token details in logs.
                    android.util.Log.w("STEVE","Gateway upload rejected; HTTP "+connection.responseCode)
                }
            } catch (e: Exception) {
                android.util.Log.w("STEVE","Gateway upload failed; measurement remains unknown to server")
            } finally { connection.disconnect() }
        }
    }
    fun shutdown() {jobs.shutdownNow()}
}
