package org.recruit.monitor

import org.junit.Assert.*
import org.junit.Test

class HeartRatePacketTest {
 @Test fun decodesStandardPacketsAndRejectsUnavailableContact() {
  assertEquals(83, HeartRatePacket.decode(byteArrayOf(0,83)))
  assertEquals(200, HeartRatePacket.decode(byteArrayOf(1,200.toByte(),0)))
  assertEquals(88, HeartRatePacket.decode(byteArrayOf(6,88)))
  assertNull(HeartRatePacket.decode(byteArrayOf(4,88)))
  assertNull(HeartRatePacket.decode(byteArrayOf(1,80)))
  assertNull(HeartRatePacket.decode(byteArrayOf(0,0)))
  assertNull(HeartRatePacket.decode(byteArrayOf(1,0,1)))
  assertNull(HeartRatePacket.decode(byteArrayOf()))
 }
}
