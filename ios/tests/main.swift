import Foundation

let fixtures: [([UInt8], Int?)] = [
    ([0,83],83), ([1,200,0],200), ([6,88],88),
    ([4,88],nil), ([1,80],nil), ([0,0],nil), ([1,0,1],nil), ([],nil)
]
for (bytes, expected) in fixtures {
    precondition(HeartRatePacket.decode(Data(bytes)) == expected, "BLE packet decoding failed")
}
print("8 synthetic BLE packet fixtures passed; no physical BLE test.")
let used = [("R01", "opaque-01")]
precondition(AssignmentRules.allows(slot: "R15", device: "opaque-15", used: used))
precondition(!AssignmentRules.allows(slot: "R01", device: "opaque-02", used: used))
precondition(!AssignmentRules.allows(slot: "R02", device: "opaque-01", used: used))
precondition(!AssignmentRules.allows(slot: "R16", device: "opaque-16", used: used))
precondition(!AssignmentRules.allows(slot: "R02", device: "AA:BB:CC", used: used))
print("5 assignment fixtures passed.")
