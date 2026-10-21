package org.recruit.monitor

/** Bluetooth SIG 0x2A37: little-endian UINT8/UINT16, with contact detection. */
object HeartRatePacket {
 fun decode(bytes: ByteArray): Int? {
  if (bytes.size < 2) return null
  val flags = bytes[0].toInt() and 255
  if (flags and 4 != 0 && flags and 2 == 0) return null
  val bpm = if (flags and 1 == 0) bytes[1].toInt() and 255
   else if (bytes.size >= 3) (bytes[1].toInt() and 255) or ((bytes[2].toInt() and 255) shl 8)
   else return null
  return bpm.takeIf { it in 25..240 }
 }
}
