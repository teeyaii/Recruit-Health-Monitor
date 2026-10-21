package org.recruit.monitor

import android.Manifest
import android.app.Activity
import android.bluetooth.*
import android.bluetooth.le.*
import android.content.pm.PackageManager
import android.os.*
import android.os.ParcelUuid
import android.widget.*
import java.util.UUID

class MainActivity : Activity() {
 private val heartService = UUID.fromString("0000180d-0000-1000-8000-00805f9b34fb")
 private val heartMeasure = UUID.fromString("00002a37-0000-1000-8000-00805f9b34fb")
 private val cccd = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
 private val connections = mutableMapOf<String, BluetoothGatt>()
 private val values = mutableMapOf<String, String>()
 private lateinit var output: TextView
 private lateinit var status: TextView
 private val adapter by lazy { (getSystemService(BLUETOOTH_SERVICE) as BluetoothManager).adapter }
 private var scanning = false

 override fun onCreate(savedInstanceState: Bundle?) {
  super.onCreate(savedInstanceState)
  val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(24,36,24,24) }
  status = TextView(this).apply { text = "Experimental Xiaomi HR broadcast reader (not medical monitoring)" }
  output = TextView(this).apply { textSize = 20f; text = "No readings" }
  val scan = Button(this).apply { text = "Scan for heart rate bands"; setOnClickListener { beginScan() } }
  layout.addView(status); layout.addView(scan); layout.addView(output)
  setContentView(layout)
 }

 private fun beginScan() {
  if (Build.VERSION.SDK_INT >= 31) {
   val missing = arrayOf(Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT)
    .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
   if (missing.isNotEmpty()) { requestPermissions(missing.toTypedArray(), 101); return }
  } else if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
   requestPermissions(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION), 101); return
  }
  if (!adapter.isEnabled) { status.text = "Please enable Bluetooth"; return }
  val scanner = adapter.bluetoothLeScanner ?: run { status.text = "BLE scanner unavailable"; return }
  try {
   if (scanning) scanner.stopScan(scanCallback)
   scanner.startScan(listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(heartService)).build()),
    ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), scanCallback)
   scanning = true
   status.text = "Scanning for up to 5 BLE heart rate broadcasters..."
  } catch (e: SecurityException) { status.text = "Bluetooth permission denied" }
 }

 private val scanCallback = object : ScanCallback() {
  override fun onScanResult(callbackType: Int, result: ScanResult) {
   val address = result.device.address
   if (connections.containsKey(address) || connections.size >= 5) return
   values[address] = "Connecting..."
   try { connections[address] = result.device.connectGatt(this@MainActivity, false, callbacks) }
   catch (e: Exception) { values[address] = "Connection error: ${e.javaClass.simpleName}" }
   redraw()
  }
  override fun onScanFailed(errorCode: Int) { runOnUiThread { status.text = "Scan error $errorCode" } }
 }

 private val callbacks = object : BluetoothGattCallback() {
  override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
   if (status == BluetoothGatt.GATT_SUCCESS && newState == BluetoothProfile.STATE_CONNECTED) {
    try { gatt.discoverServices() } catch (_: SecurityException) {}
   } else {
    values[gatt.device.address] = "DISCONNECTED (last reading invalid)"
    redraw()
   }
  }
  override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
   val characteristic = gatt.getService(heartService)?.getCharacteristic(heartMeasure)
   if (status != BluetoothGatt.GATT_SUCCESS || characteristic == null) {
    values[gatt.device.address] = "HR characteristic unavailable"; redraw(); return
   }
   try {
    gatt.setCharacteristicNotification(characteristic, true)
    val descriptor = characteristic.getDescriptor(cccd)
    if (descriptor == null) { values[gatt.device.address] = "Notifications unavailable"; redraw(); return }
    if (Build.VERSION.SDK_INT >= 33) {
     gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
    } else {
     @Suppress("DEPRECATION")
     descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
     @Suppress("DEPRECATION")
     gatt.writeDescriptor(descriptor)
    }
    values[gatt.device.address] = "Connected; waiting for HR..."
   } catch (_: SecurityException) { values[gatt.device.address] = "Permission error" }
   redraw()
  }
  override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
   parse(gatt.device.address, value)
  }
  @Deprecated("Android legacy BLE callback")
  override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
   @Suppress("DEPRECATION")
   val bytes = characteristic.value ?: return
   parse(gatt.device.address, bytes)
  }
 }

 private fun parse(address: String, bytes: ByteArray) {
  if (bytes.size < 2) return
  val flags = bytes[0].toInt() and 255
  val hr = if (flags and 1 == 0) bytes[1].toInt() and 255
           else if (bytes.size >= 3) (bytes[1].toInt() and 255) or ((bytes[2].toInt() and 255) shl 8)
           else return
  val time = java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US).format(java.util.Date())
  values[address] = "$hr BPM | $time"
  redraw()
 }
 private fun redraw() = runOnUiThread {
  output.text = if (values.isEmpty()) "No devices" else values.entries.joinToString("\n\n") { (id, value) -> "${id.takeLast(5)}: $value" }
 }
 override fun onDestroy() {
  super.onDestroy()
  try { if (scanning) adapter.bluetoothLeScanner?.stopScan(scanCallback) } catch (_: Exception) {}
  connections.values.forEach { try { it.close() } catch (_: Exception) {} }
 }
}
