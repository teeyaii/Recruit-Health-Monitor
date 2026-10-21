import SwiftUI

@main
struct STEVEGatewayApp: App {
    var body: some Scene { WindowGroup { GatewayHomeView() } }
}

struct GatewayHomeView: View {
    @StateObject private var central = HeartRateCentral()
    @Environment(\.scenePhase) private var scenePhase
    @State private var endpoint = ""
    @State private var token = ""
    @State private var gateway = "G01"

    var body: some View {
        NavigationStack {
            List {
                Section("LIVE gateway • foreground prototype") {
                    Text("Not a medical monitor. Keep this screen open. Returning from background requires Retry.")
                    TextField("HTTPS server origin", text: $endpoint).textInputAutocapitalization(.never).autocorrectionDisabled()
                    Picker("Gateway", selection: $gateway) {
                        ForEach(1...5, id: \.self) { n in Text("G0\(n)").tag("G0\(n)") }
                    }
                    SecureField("Gateway credential", text: $token)
                    Button("Apply configuration") {
                        central.configure(url: endpoint.trimmingCharacters(in: .whitespaces), gateway: gateway, token: token)
                        token = ""
                    }
                    Text(central.message)
                    Text(central.uploadStatus).font(.caption)
                    Text(central.bluetoothReady ? "Bluetooth ready" : "Bluetooth unavailable")
                    Button("Test HTTPS Gateway (no BPM)") { central.testServerConnection() }
                    Button("Scan HR devices (15 seconds)") { central.start() }
                    Button("Broad scan nearby BLE (if no HR device appears)") {
                        central.start(allDevices: true)
                    }
                    Text("Broad Scan only discovers devices. It cannot prove the band broadcasts live heart rate.")
                        .font(.caption).foregroundStyle(.secondary)
                    Button("Stop and clear assignments") { central.clear() }
                }
                Section("Choose a device, then confirm its slot") {
                    ForEach(central.names.keys.sorted(by: { $0.uuidString < $1.uuidString }), id: \.self) { id in
                        DeviceRow(central: central, id: id)
                    }
                }
            }.navigationTitle("STEVE 1.0")
        }
        .onChange(of: scenePhase) { _, phase in
            central.setForeground(phase == .active)
            UIApplication.shared.isIdleTimerDisabled = phase == .active
        }
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true }
    }
}

private struct DeviceRow: View {
    @ObservedObject var central: HeartRateCentral
    let id: UUID
    @State private var slot = "R01"
    @State private var deviceID = ""
    var body: some View {
        VStack(alignment: .leading) {
            Text((central.names[id] ?? "HR device") + " • " + id.uuidString.prefix(8))
            Text(central.statuses[id] ?? "NO DATA").font(.caption)
            if let pair = central.pairs[id] {
                Text(pair.slot)
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    if let at = pair.measuredAt, let bpm = pair.bpm, context.date.timeIntervalSince(at) <= 15 {
                        Text("\(bpm) BPM")
                    } else { Text(pair.measuredAt == nil ? "NO DATA" : "STALE — unknown") }
                }
                if let date = pair.measuredAt { Text("Last measurement: " + date.formatted(date: .omitted, time: .standard)).font(.caption) }
                Button("Retry connection") { central.retry(id) }
            } else {
                Picker("Slot", selection: $slot) {
                    ForEach(1...15, id: \.self) { n in
                        Text(String(format: "R%02d", n)).tag(String(format: "R%02d", n))
                    }
                }
                TextField("Provisioned opaque device ID", text: $deviceID).textInputAutocapitalization(.never).autocorrectionDisabled()
                Button("Confirm assignment and connect") { central.assign(id, slot: slot, deviceID: deviceID) }
            }
        }.buttonStyle(.borderless)
    }
}

