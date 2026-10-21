import Foundation

/// HTTPS only; no redirects or credential persistence.
final class GatewayUploadClient: NSObject, URLSessionTaskDelegate {
    enum UploadError: Error { case invalidEndpoint, expired, rejected(Int), notAccepted }
    private let endpoint: URL
    private let gatewayID: String
    private let token: String
    private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

    init(serverBaseURL: URL, gatewayID: String, bearerToken: String) throws {
        guard serverBaseURL.scheme == "https", serverBaseURL.host != nil,
              serverBaseURL.user == nil, serverBaseURL.password == nil,
              serverBaseURL.query == nil, serverBaseURL.fragment == nil,
              serverBaseURL.path.isEmpty || serverBaseURL.path == "/" else { throw UploadError.invalidEndpoint }
        guard (1...5).map({ "G0\($0)" }).contains(gatewayID), bearerToken.count >= 32 else {
            throw UploadError.invalidEndpoint
        }
        endpoint = serverBaseURL.appendingPathComponent("api/ingest")
        self.gatewayID = gatewayID
        token = bearerToken
        super.init()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func submit(slotID: String, deviceID: String, bpm: Int?, recordedAt: Date) async throws {
        guard (1...15).map({ String(format: "R%02d", $0) }).contains(slotID),
              deviceID.range(of: "^[a-zA-Z0-9_-]{4,64}$", options: .regularExpression) != nil,
              bpm == nil || (25...240).contains(bpm!) else { throw UploadError.invalidEndpoint }
        var reading: [String: Any] = ["id": slotID, "device_id": deviceID,
            "timestamp": Int(recordedAt.timeIntervalSince1970 * 1000)]
        if let bpm = bpm { reading["hr"] = bpm } else { reading["state"] = "DISCONNECTED" }
        try await send([reading], recordedAt: recordedAt)
    }
    func heartbeat() async throws { try await send([], recordedAt: Date()) }
    private func send(_ readings: [[String: Any]], recordedAt: Date) async throws {
        var request = URLRequest(url: endpoint)
        request.httpMethod = "POST"; request.timeoutInterval = 4
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer " + token, forHTTPHeaderField: "Authorization")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["gateway": gatewayID, "readings": readings])
        for attempt in 0..<3 {
            try Task.checkCancellation()
            guard Date().timeIntervalSince(recordedAt) < 12 else { throw UploadError.expired }
            do {
                let (data, response) = try await session.data(for: request)
                let code = (response as? HTTPURLResponse)?.statusCode ?? -1
                if code == 200 {
                    let json = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    guard json?["accepted"] as? Int == readings.count else { throw UploadError.notAccepted }
                    return
                }
                if code != 429 && code < 500 { throw UploadError.rejected(code) }
                if attempt == 2 { throw UploadError.rejected(code) }
            } catch let error as UploadError { throw error }
              catch { if attempt == 2 || Task.isCancelled { throw error } }
            try await Task.sleep(nanoseconds: UInt64(attempt + 1) * 500_000_000)
        }
    }
    func shutdown() { session.invalidateAndCancel() }
}

