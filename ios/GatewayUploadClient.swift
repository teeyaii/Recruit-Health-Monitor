import Foundation

/// Transport for a manually provisioned iOS BLE gateway. This is source code only:
/// not an installed app and not evidence of a tested Bluetooth connection.
final class GatewayUploadClient {
    enum UploadError: Error { case invalidEndpoint, rejected(Int) }
    private let endpoint: URL
    private let gatewayID: String
    private let token: String

    init(serverBaseURL: URL, gatewayID: String, bearerToken: String) throws {
        guard serverBaseURL.scheme == "https", serverBaseURL.host != nil,
              (1...5).contains(Int(gatewayID.suffix(1)) ?? 0),
              gatewayID.hasPrefix("G0"), gatewayID.count == 3, !bearerToken.isEmpty else {
            throw UploadError.invalidEndpoint
        }
        endpoint = serverBaseURL.appendingPathComponent("api/ingest")
        self.gatewayID = gatewayID
        self.token = bearerToken
    }

    func submit(slotID: String, deviceID: String, bpm: Int, recordedAt: Date = Date()) async throws {
        // Device-to-slot mapping must be confirmed by the operator, not inferred from discovery order.
        guard (1...15).contains(Int(slotID.dropFirst()) ?? 0),
              slotID.hasPrefix("R"), slotID.count == 3,
              (25...240).contains(bpm), !deviceID.isEmpty else { throw UploadError.invalidEndpoint }
        let reading: [String: Any] = [
            "id": slotID, "device_id": deviceID, "hr": bpm,
            "timestamp": Int(recordedAt.timeIntervalSince1970 * 1000)
        ]
        let payload: [String: Any] = ["gateway":gatewayID,"readings":[reading]]
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"
        request.timeoutInterval = 6
        request.setValue("application/json", forHTTPHeaderField:"Content-Type")
        request.setValue("Bearer "+token, forHTTPHeaderField:"Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject:payload)
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw UploadError.rejected((response as? HTTPURLResponse)?.statusCode ?? -1)
        }
    }
}
