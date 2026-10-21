import Foundation

enum HeartRatePacket {
    static func decode(_ data: Data) -> Int? {
        let bytes = [UInt8](data)
        guard bytes.count >= 2 else { return nil }
        if bytes[0] & 4 != 0 && bytes[0] & 2 == 0 { return nil }
        let wide = bytes[0] & 1 != 0
        guard !wide || bytes.count >= 3 else { return nil }
        let bpm = wide ? Int(bytes[1]) | (Int(bytes[2]) << 8) : Int(bytes[1])
        return (25...240).contains(bpm) ? bpm : nil
    }
}
