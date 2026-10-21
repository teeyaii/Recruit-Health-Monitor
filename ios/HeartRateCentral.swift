import Foundation
import CoreBluetooth

/// Experimental iOS BLE reader. No networking, no recruit identity, no medical use.
final class HeartRateCentral: NSObject, ObservableObject, CBCentralManagerDelegate, CBPeripheralDelegate {
    @Published private(set) var readings: [UUID: Int] = [:]
    @Published private(set) var statuses: [UUID: String] = [:]
    @Published private(set) var bluetoothReady = false

    private let serviceID = CBUUID(string: "180D")
    private let measurementID = CBUUID(string: "2A37")
    private var central: CBCentralManager!
    private var peripherals: [UUID: CBPeripheral] = [:]

    override init() {
        super.init()
        central = CBCentralManager(delegate: self, queue: .main)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        bluetoothReady = central.state == .poweredOn
        if !bluetoothReady { for id in peripherals.keys { statuses[id] = "Bluetooth unavailable" } }
    }

    func start() {
        guard central.state == .poweredOn else { return }
        central.scanForPeripherals(withServices: [serviceID],
                                   options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func stop() {
        central.stopScan()
        for peripheral in peripherals.values { central.cancelPeripheralConnection(peripheral) }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let id = peripheral.identifier
        guard peripherals[id] == nil else { return }
        peripherals[id] = peripheral
        peripheral.delegate = self
        statuses[id] = "Connecting"
        central.connect(peripheral)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        statuses[peripheral.identifier] = "Discovering HR service"
        peripheral.discoverServices([serviceID])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        statuses[peripheral.identifier] = "Connection failed"
        readings.removeValue(forKey: peripheral.identifier)
        peripherals.removeValue(forKey: peripheral.identifier)
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        statuses[peripheral.identifier] = "Disconnected / stale"
        readings.removeValue(forKey: peripheral.identifier)
        peripherals.removeValue(forKey: peripheral.identifier)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard error == nil else { statuses[peripheral.identifier] = "Service discovery error"; return }
        for service in peripheral.services ?? [] where service.uuid == serviceID {
            peripheral.discoverCharacteristics([measurementID], for: service)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard error == nil else { statuses[peripheral.identifier] = "Characteristic discovery error"; return }
        for characteristic in service.characteristics ?? [] where characteristic.uuid == measurementID {
            peripheral.setNotifyValue(true, for: characteristic)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        statuses[peripheral.identifier] = error == nil && characteristic.isNotifying ? "Waiting for HR" : "Notifications unavailable"
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard error == nil, characteristic.uuid == measurementID,
              let data = characteristic.value, data.count >= 2 else { return }
        let bytes = [UInt8](data)
        let is16Bit = bytes[0] & 1 != 0
        guard !is16Bit || bytes.count >= 3 else { return }
        let bpm = is16Bit ? Int(bytes[1]) | (Int(bytes[2]) << 8) : Int(bytes[1])
        guard (25...240).contains(bpm) else { return }
        readings[peripheral.identifier] = bpm
        statuses[peripheral.identifier] = "Receiving"
    }
}
