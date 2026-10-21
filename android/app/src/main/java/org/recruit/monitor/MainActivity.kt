package org.recruit.monitor

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.pm.PackageManager
import android.os.*
import android.text.InputType
import android.view.WindowManager
import android.widget.*
import java.util.UUID

/** Foreground MVP. All Bluetooth state is serialized onto the main thread. */
class MainActivity : Activity() {
 private val heartService = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
 private val heartMeasure = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
 private val cccd = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
 private val handler = Handler(Looper.getMainLooper())
 private val adapter by lazy { (getSystemService(BLUETOOTH_SERVICE) as BluetoothManager).adapter }
 private val devices = linkedMapOf<String,BluetoothDevice>()
 private val connections = mutableMapOf<String,BluetoothGatt>()
 private data class Pairing(val slot: String, val opaque: String, var state: String = "NO DATA",
  var bpm: Int? = null, var measured: Long = 0, var sent: Long = 0, var attempts: Int = 0)
 private val pairs = mutableMapOf<String,Pairing>()
 private var uploader: GatewayUploader? = null
 private var scanning = false
 private var scanGeneration = 0
 private var foreground = false
 private var generation = 0
 private lateinit var rows: LinearLayout
 private lateinit var status: TextView
 private lateinit var uploadStatus: TextView
 private lateinit var connectionTestStatus: TextView
 private lateinit var url: EditText
 private lateinit var token: EditText
 private lateinit var gateway: Spinner

 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24,30,24,24) }
  layout.addView(TextView(this).apply { text = "STEVE 1.0 • LIVE gateway\nForeground prototype; not a medical monitor. Keep this screen open." })
  url = EditText(this).apply { hint = "HTTPS server origin"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI }
  token = EditText(this).apply { hint = "Gateway credential (32+ characters)"; inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD; isSaveEnabled = false }
  gateway = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,(1..5).map { "G0$it" }) }
  layout.addView(url); layout.addView(gateway); layout.addView(token)
  layout.addView(Button(this).apply { text = "Apply gateway configuration"; setOnClickListener {
   if (pairs.isNotEmpty()) { status.text = "Stop and clear assignments before changing gateway"; return@setOnClickListener }
   try {
    val next = GatewayUploader(url.text.toString().trim(),gateway.selectedItem.toString(),token.text.toString()) { message ->
     runOnUiThread { uploadStatus.text = message }
    }
    uploader?.shutdown(); uploader = next; token.text.clear()
    connectionTestStatus.text = "HTTPS gateway test not run"
    status.text = "Configured. Scan, choose device, then assign a provisioned slot."
   } catch (_: Exception) { status.text = "Use an HTTPS origin, G01–G05 and a 32+ character credential" }
  } })
  status = TextView(this); uploadStatus = TextView(this).apply { text = "Upload not configured" }
  connectionTestStatus = TextView(this).apply { text = "HTTPS gateway test not run" }
  layout.addView(status); layout.addView(uploadStatus); layout.addView(connectionTestStatus)
  layout.addView(Button(this).apply { text = "Test HTTPS Gateway (no BPM)"; setOnClickListener {
   if (pairs.isNotEmpty()) { connectionTestStatus.text = "Clear assignments before running the standalone gateway test"; return@setOnClickListener }
   val sender = uploader ?: run { connectionTestStatus.text = "Configure HTTPS and gateway credential first"; return@setOnClickListener }
   connectionTestStatus.text = "Testing Gateway -> Render (empty heartbeat; allow free instance to wake)..."
   sender.testConnection { message -> runOnUiThread { connectionTestStatus.text = message } }
  } })
  layout.addView(Button(this).apply { text = "Scan HR devices (15 seconds)"; setOnClickListener { beginScan() } })
  layout.addView(Button(this).apply { text = "Broad scan nearby BLE (if none found)"; setOnClickListener {
   beginScan(allDevices = true)
  } })
  layout.addView(TextView(this).apply { text = "Broad Scan discovers nearby BLE devices only; it does not prove heart-rate broadcast compatibility." })
  layout.addView(Button(this).apply { text = "Stop and clear assignments"; setOnClickListener { stopAll(); pairs.clear(); redraw() } })
  rows = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
  layout.addView(rows)
  setContentView(ScrollView(this).apply { addView(layout) })
 }
 private fun permitted(): Boolean {
  val needed = if (Build.VERSION.SDK_INT >= 31) arrayOf(Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT)
   else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
  val missing = needed.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
  if (missing.isNotEmpty()) { requestPermissions(missing.toTypedArray(),101); return false }
  return true
 }
 private fun beginScan(allDevices: Boolean = false) {
  if (!permitted()) return
  try {
   if (adapter?.isEnabled != true) { status.text = "Enable Bluetooth first"; return }
   stopScan()
   devices.entries.removeAll { !pairs.containsKey(it.key) }
   val filters = if (allDevices) null else listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(heartService)).build())
   val scanner = adapter.bluetoothLeScanner ?: run { status.text = "BLE scanner unavailable"; return }
   val epoch = ++scanGeneration
   scanner.startScan(filters, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
   scanning = true
   status.text = if (allDevices) "Broad BLE scan, 15s: finding a device does NOT prove HR broadcast"
     else "Scanning HR Service 180D, 15s. Try Broad Scan if none found"
   handler.postDelayed({ if (scanGeneration == epoch) stopScan() },15000)
  } catch (_: Exception) { status.text = "Scan unavailable; check Bluetooth permissions" }
 }
 private fun stopScan() {
  scanGeneration++
  try { if (scanning) adapter?.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
  scanning = false
 }
 private val scanCallback = object : ScanCallback() {
  override fun onScanResult(callbackType: Int, result: ScanResult) { runOnUiThread {
   if (!scanning || (devices.size >= 40 && !devices.containsKey(result.device.address))) return@runOnUiThread
   devices[result.device.address] = result.device; redraw()
  } }
  override fun onScanFailed(errorCode: Int) { runOnUiThread { scanning = false; status.text = "Scan failed: $errorCode" } }
 }
 private fun assign(address: String) {
  if (uploader == null) { status.text = "Configure HTTPS upload first"; return }
  if (pairs.containsKey(address)) { pairs[address]?.attempts = 0; connect(address); return }
  val form = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24,16,24,16) }
  val slots = Spinner(this).apply { adapter = ArrayAdapter(this@MainActivity,android.R.layout.simple_spinner_dropdown_item,(1..15).map { "R" + it.toString().padStart(2,'0') }) }
  val opaque = EditText(this).apply { hint = "Provisioned opaque device ID (not MAC/name)" }
  form.addView(slots); form.addView(opaque)
  AlertDialog.Builder(this).setTitle("Confirm device → recruit slot").setView(form)
   .setNegativeButton("Cancel",null).setPositiveButton("Assign and connect") { _,_ ->
    val slot = slots.selectedItem.toString(); val id = opaque.text.toString().trim()
    if (!AssignmentRules.allows(slot,id,pairs.values.map { it.slot to it.opaque })) {
     status.text = "Invalid or duplicate slot/device ID"; return@setPositiveButton
    }
    pairs[address] = Pairing(slot,id); connect(address)
   }.show()
 }
 private fun connect(address: String) {
  val pair = pairs[address] ?: return
  if (!foreground || connections.containsKey(address)) return
  pair.state = "CONNECTING"; pair.bpm = null
  try {
   val gatt = devices[address]?.connectGatt(this,false,callbacks,BluetoothDevice.TRANSPORT_LE) ?: return
   connections[address] = gatt
   handler.postDelayed({
    if (connections[address] === gatt && pair.state != "CONNECTED") fail(gatt,"Connection/subscription timeout")
   },12000)
  } catch (_: Exception) { pair.state = "DISCONNECTED"; status.text = "Check Bluetooth and permissions" }
  redraw()
 }
 private fun fail(gatt: BluetoothGatt, reason: String) {
  val address = gatt.device.address
  if (connections[address] !== gatt) return
  connections.remove(address)
  try { gatt.disconnect(); gatt.close() } catch (_: Exception) {}
  val pair = pairs[address] ?: return
  pair.bpm = null; pair.state = "DISCONNECTED • $reason"
  uploader?.submit(pair.slot,pair.opaque,null)
  if (foreground && pair.attempts < 3) {
   pair.attempts++
   val epoch = generation
   handler.postDelayed({ if (epoch == generation && pairs[address] === pair) connect(address) },2000L * pair.attempts)
  } else { pair.state += " • tap Retry" }
  redraw()
 }
 private val callbacks = object : BluetoothGattCallback() {
  override fun onConnectionStateChange(gatt: BluetoothGatt, code: Int, newState: Int) { runOnUiThread {
   if (connections[gatt.device.address] !== gatt) return@runOnUiThread
   if (code == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
    try { if (!gatt.discoverServices()) fail(gatt,"Service discovery failed") } catch (_: Exception) { fail(gatt,"Permission denied") }
   } else if (newState == BluetoothProfile.STATE_DISCONNECTED || code != BluetoothGatt.GATT_SUCCESS) fail(gatt,"Link lost")
  } }
  override fun onServicesDiscovered(gatt: BluetoothGatt, code: Int) { runOnUiThread {
   if (connections[gatt.device.address] !== gatt) return@runOnUiThread
   val c = gatt.getService(heartService)?.getCharacteristic(heartMeasure)
   val descriptor = c?.getDescriptor(cccd)
   if (code != BluetoothGatt.GATT_SUCCESS || c == null || descriptor == null) { fail(gatt,"HR service unavailable"); return@runOnUiThread }
   try {
    if (!gatt.setCharacteristicNotification(c,true)) { fail(gatt,"Notifications unavailable"); return@runOnUiThread }
    val started = if (Build.VERSION.SDK_INT >= 33) gatt.writeDescriptor(descriptor,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) == BluetoothStatusCodes.SUCCESS
     else { descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE; gatt.writeDescriptor(descriptor) }
    if (!started) fail(gatt,"Subscription failed")
   } catch (_: Exception) { fail(gatt,"Permission denied") }
  } }
  override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, code: Int) { runOnUiThread {
   if (connections[gatt.device.address] !== gatt) return@runOnUiThread
   if (code != BluetoothGatt.GATT_SUCCESS) fail(gatt,"Subscription rejected")
   else { pairs[gatt.device.address]?.state = "CONNECTED"; redraw() }
  } }
  override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
   if (characteristic.uuid == heartMeasure) receive(gatt,value)
  }
  @Deprecated("Legacy Android BLE callback")
  override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
   if (characteristic.uuid == heartMeasure) characteristic.value?.let { receive(gatt,it.copyOf()) }
  }
 }
 private fun receive(gatt: BluetoothGatt, bytes: ByteArray) = runOnUiThread {
  val address = gatt.device.address
  if (connections[address] !== gatt) return@runOnUiThread
  val pair = pairs[address] ?: return@runOnUiThread
  val bpm = HeartRatePacket.decode(bytes)
  if (bpm == null) { pair.bpm = null; uploader?.submit(pair.slot,pair.opaque,null); redraw(); return@runOnUiThread }
  val now = System.currentTimeMillis()
  pair.bpm = bpm; pair.measured = now; pair.state = "CONNECTED"
  // Reconnect budget is session-wide; operator can explicitly retry after 3 failures.
  if (now-pair.sent >= 1000) { pair.sent = now; uploader?.submit(pair.slot,pair.opaque,bpm,now) }
  redraw()
 }
 private fun redraw() {
  rows.removeAllViews()
  devices.forEach { (address,device) ->
   val pair = pairs[address]
   val label = try { device.name ?: "HR device" } catch (_: Exception) { "HR device" }
   val fresh = pair?.bpm != null && System.currentTimeMillis()-pair.measured <= 15000
   rows.addView(TextView(this).apply {
    text = label + " • " + address.takeLast(5) + "\n" + (pair?.let {
     it.slot + " • " + it.state + "\n" + (if (fresh) "${it.bpm} BPM" else if (it.measured == 0L) "NO DATA" else "STALE — unknown") +
     "\nLast measurement: " + (if (it.measured == 0L) "never" else java.util.Date(it.measured).toString())
    } ?: "Unassigned — confirm device before connecting")
   })
   rows.addView(Button(this).apply { text = if (pair == null) "Assign slot and connect" else "Retry connection"; setOnClickListener { assign(address) } })
  }
 }
 private val refresh = object : Runnable {
  override fun run() { if (foreground) { redraw(); handler.postDelayed(this,1000) } }
 }
 private val heartbeat = object : Runnable {
  override fun run() { if (foreground) { uploader?.heartbeat(); handler.postDelayed(this,5000) } }
 }
 override fun onResume() { super.onResume(); foreground = true; handler.post(refresh); handler.post(heartbeat) }
 private fun stopAll() {
  generation++; stopScan()
  pairs.values.forEach { it.bpm = null; it.state = "DISCONNECTED"; uploader?.submit(it.slot,it.opaque,null) }
  val old = connections.values.toList(); connections.clear()
  old.forEach { try { it.disconnect(); it.close() } catch (_: Exception) {} }
 }
 override fun onPause() {
  foreground = false; handler.removeCallbacks(refresh); handler.removeCallbacks(heartbeat); stopAll()
  super.onPause()
 }
 override fun onDestroy() { handler.removeCallbacksAndMessages(null); uploader?.shutdown(); super.onDestroy() }
}

