package org.recruit.monitor

object AssignmentRules {
 fun allows(slot: String, device: String, used: Collection<Pair<String,String>>): Boolean =
  Regex("R(0[1-9]|1[0-5])").matches(slot) &&
  Regex("[a-zA-Z0-9_-]{4,64}").matches(device) &&
  used.none { it.first == slot || it.second == device }
}
