import Foundation

enum AssignmentRules {
    static func allows(slot: String, device: String, used: [(String, String)]) -> Bool {
        (1...15).map({ String(format: "R%02d", $0) }).contains(slot) &&
        device.range(of: "^[a-zA-Z0-9_-]{4,64}$", options: .regularExpression) != nil &&
        !used.contains(where: { $0.0 == slot || $0.1 == device })
    }
}
