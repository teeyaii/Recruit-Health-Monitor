import Foundation

let fixtures: [([UInt8], Int?)] = [
    ([0,83],83), ([1,200,0],200), ([6,88],88),
    ([4,88],nil), ([1,80],nil), ([0,0],nil), ([1,0,1],nil), ([],nil)
]
for (bytes, expected) in fixtures {
    precondition(HeartRatePacket.decode(Data(bytes)) == expected, "BLE packet decoding failed")
}
print("8 synthetic BLE packet fixtures passed; no physical BLE test.")
