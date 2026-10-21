import Foundation
import Combine
import CoreBluetooth

/// Foreground MVP; all state and callbacks run on the main queue.
final class HeartRateCentral: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    struct Pairing {
        let slot: String
        let deviceID: String
        var bpm: Int?
        var measuredAt: Date?
        var sentAt = Date.distantPast
        var attempts = 0
    }
    @Published private(set) var names: [UUID: String] = [:]
    @Published private(set) var statuses: [UUID: String] = [:]
    @Published private(set) var pairs: [UUID: Pairing] = [:]
    @Published private(set) var bluetoothReady = false
    @Published private(set) var message = "Configure upload, then scan and explicitly assign devices."
    @Published private(set) var uploadStatus = "Upload not configured"
    private let serviceID = CBUUID(string: "180D")
    private let measurementID = CBUUID(string: "2A37")
    private var central: CBCentralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]
    private var active = Set<UUID>()
    private var reconnects: [UUID: DispatchWorkItem] = [:]
    private var timeouts: [UUID: DispatchWorkItem] = [:]
    private var uploads: [UUID: Task<Void, Never>] = [:]
    private var heartbeatTask: Task<Void, Never>?
    private var client: GatewayUploadClient?
    private var timer: Timer?
    private var foreground = true
    private var scanning = false
    private var scanGeneration = 0

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in self?.heartbeat() }
    }
    func configure(url: String, gateway: String, token: String) {
        guard pairs.isEmpty else { message = "Clear assignments before changing gateway."; return }
        do {
            guard let endpoint = URL(string: url) else { throw GatewayUploadClient.UploadError.invalidEndpoint }
            let next = try GatewayUploadClient(serverBaseURL: endpoint, gatewayID: gateway, bearerToken: token)
            client?.shutdown(); client = next
            message = "Configured. Use the opaque device IDs provisioned on the server."
        } catch { message = "Use an HTTPS origin and a gateway credential of at least 32 characters." }
    }
    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothReady = central.state == .poweredOn
        if !bluetoothReady { stop() }
    }
    /// Standard scan only sees devices advertising 180D. A wider scan is opt-in
    /// and still requires an explicit slot assignment before any connection.
    func start(allDevices: Bool = false) {
        guard bluetoothReady && foreground else {
            message = "Enable Bluetooth and keep STEVE in the foreground."; return
        }
        central.stopScan()
        scanGeneration += 1
        let generation = scanGeneration
        scanning = true
        message = allDevices
          ? "Broad BLE scan (15s). Discovery does not prove Heart Rate Service support."
          : "Searching advertised Heart Rate Service 180D (15s). Try Broad Scan if missing."
        central.scanForPeripherals(withServices: allDevices ? nil : [serviceID],
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, self.scanGeneration == generation else { return }
            self.central.stopScan()
            self.scanning = false
            self.message = "Scan finished. Assign a device explicitly or try Broad Scan."
        }
    }
    /// End-to-end HTTPS/credential probe with ZERO heart-rate readings.
    /// Does not require a band and cannot validate actual BLE compatibility.
    func testServerConnection() {
        guard let client = client else { uploadStatus = "Configure HTTPS and gateway credential first."; return }
        guard foreground else { uploadStatus = "Open STEVE in the foreground to test."; return }
        uploadStatus = "Testing Gateway -> HTTPS server (empty heartbeat)..."
        Task { @MainActor [weak self] in
            do {
                try await client.testConnection()
                self?.uploadStatus = "Gateway/credential verified; no BPM was sent."
            } catch {
                self?.uploadStatus = "Gateway test failed: verify HTTPS, token, gateway ID, or Render wake-up."
            }
        }
    }
    func assign(_ id: UUID, slot: String, deviceID: String) {
        guard client != nil else { message = "Configure upload first."; return }
        guard pairs[id] == nil, AssignmentRules.allows(slot: slot, device: deviceID,
              used: pairs.values.map { ($0.slot, $0.deviceID) }) else {
            message = "Invalid or duplicate slot/device assignment."; return
        }
        pairs[id] = Pairing(slot: slot, deviceID: deviceID)
        connect(id)
    }
    func retry(_ id: UUID) {
        reconnects[id]?.cancel(); reconnects[id] = nil
        pairs[id]?.attempts = 0
        connect(id)
    }
    private func connect(_ id: UUID) {
        guard foreground, bluetoothReady, pairs[id] != nil, !active.contains(id),
              let peripheral = peripherals[id], peripheral.state == .disconnected else { return }
        active.insert(id); statuses[id] = "CONNECTING"
        central.connect(peripheral)
        let timeout = DispatchWorkItem { [weak self] in
            guard let self = self, self.active.contains(id), self.statuses[id] != "CONNECTED" else { return }
            self.central.cancelPeripheralConnection(peripheral)
            self.failed(id)
        }
        timeouts[id] = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 12, execute: timeout)
    }
    func stop() {
        scanGeneration += 1
        central.stopScan(); scanning = false
        reconnects.values.forEach { $0.cancel() }; reconnects.removeAll()
        timeouts.values.forEach { $0.cancel() }; timeouts.removeAll()
        active.removeAll()
        for (id, peripheral) in peripherals where pairs[id] != nil {
            pairs[id]?.bpm = nil; statuses[id] = "DISCONNECTED / STALE"
            upload(id, bpm: nil, at: Date())
            central.cancelPeripheralConnection(peripheral)
        }
    }
    func clear() { stop(); pairs.removeAll(); message = "Assignments cleared." }
    func setForeground(_ value: Bool) { foreground = value; if !value { stop() } }
    private func failed(_ id: UUID) {
        guard active.remove(id) != nil else { return }
        timeouts[id]?.cancel(); timeouts[id] = nil
        pairs[id]?.bpm = nil; statuses[id] = "DISCONNECTED / STALE"
        upload(id, bpm: nil, at: Date())
        guard foreground, bluetoothReady, let pair = pairs[id], pair.attempts < 3 else {
            statuses[id] = "DISCONNECTED / STALE — tap Retry"; return
        }
        pairs[id]?.attempts += 1
        let work = DispatchWorkItem { [weak self] in self?.connect(id) }
        reconnects[id] = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(pair.attempts + 1) * 2, execute: work)
    }
    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard scanning, peripherals.count < 40 || peripherals[peripheral.identifier] != nil else { return }
        peripherals[peripheral.identifier] = peripheral
        peripheral.delegate = self
        names[peripheral.identifier] = peripheral.name ?? "HR device"
        if pairs[peripheral.identifier] == nil { statuses[peripheral.identifier] = "Unassigned" }
    }
    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard active.contains(peripheral.identifier) else { central.cancelPeripheralConnection(peripheral); return }
        statuses[peripheral.identifier] = "Discovering HR service"
        peripheral.discoverServices([serviceID])
    }
    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) { failed(peripheral.identifier) }
    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) { failed(peripheral.identifier) }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard active.contains(peripheral.identifier) else { return }
        guard error == nil, let service = peripheral.services?.first(where: { $0.uuid == serviceID }) else {
            central.cancelPeripheralConnection(peripheral); failed(peripheral.identifier); return
        }
        peripheral.discoverCharacteristics([measurementID], for: service)
    }
    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard active.contains(peripheral.identifier) else { return }
        guard error == nil, let c = service.characteristics?.first(where: { $0.uuid == measurementID }), c.properties.contains(.notify) else {
            central.cancelPeripheralConnection(peripheral); failed(peripheral.identifier); return
        }
        peripheral.setNotifyValue(true, for: c)
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard active.contains(peripheral.identifier), characteristic.uuid == measurementID else { return }
        if error == nil && characteristic.isNotifying {
            statuses[peripheral.identifier] = "CONNECTED"
            timeouts[peripheral.identifier]?.cancel()
        } else { central.cancelPeripheralConnection(peripheral); failed(peripheral.identifier) }
    }
    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        let id = peripheral.identifier
        guard active.contains(id), pairs[id] != nil, characteristic.uuid == measurementID else { return }
        guard error == nil, let data = characteristic.value, let bpm = HeartRatePacket.decode(data) else {
            pairs[id]?.bpm = nil; upload(id, bpm: nil, at: Date()); return
        }
        let now = Date()
        pairs[id]?.bpm = bpm; pairs[id]?.measuredAt = now
        if now.timeIntervalSince(pairs[id]!.sentAt) >= 1 {
            pairs[id]?.sentAt = now; upload(id, bpm: bpm, at: now)
        }
    }
    private func upload(_ id: UUID, bpm: Int?, at: Date) {
        guard let client = client, let pair = pairs[id] else { return }
        // At most one request per device. Disconnect supersedes a pending reading.
        if bpm == nil { uploads[id]?.cancel(); uploads[id] = nil }
        guard uploads[id] == nil else { return }
        uploads[id] = Task { @MainActor [weak self] in
            do {
                try await client.submit(slotID: pair.slot, deviceID: pair.deviceID, bpm: bpm, recordedAt: at)
                if !Task.isCancelled { self?.uploadStatus = "Server acknowledged" }
            } catch {
                if !Task.isCancelled { self?.uploadStatus = "Upload not accepted / unavailable; check mapping, credential and network." }
            }
            if !Task.isCancelled { self?.uploads[id] = nil }
        }
    }
    private func heartbeat() {
        guard foreground, let client = client, heartbeatTask == nil else { return }
        heartbeatTask = Task { @MainActor [weak self] in
            do { try await client.heartbeat() } catch { self?.uploadStatus = "Gateway heartbeat unavailable" }
            self?.heartbeatTask = nil
        }
    }
}

