package org.recruit.monitor

import org.junit.Assert.*
import org.junit.Test

class HeartRatePacketTest {
 @Test fun rejectsDuplicateAndInvalidAssignments() {
  val used = listOf("R01" to "opaque-01")
  assertTrue(AssignmentRules.allows("R15","opaque-15",used))
  assertFalse(AssignmentRules.allows("R01","opaque-02",used))
  assertFalse(AssignmentRules.allows("R02","opaque-01",used))
  assertFalse(AssignmentRules.allows("R16","opaque-16",used))
  assertFalse(AssignmentRules.allows("R02","AA:BB:CC",used))
 }
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
