import SwiftUI

@main
struct STEVEGatewayApp: App {
    var body: some Scene { WindowGroup { GatewayHomeView() } }
}

struct GatewayHomeView: View {
    @StateObject private var central = HeartRateCentral()

    var body: some View {
        NavigationStack {
            List {
                Section("Experimental Bluetooth reader") {
                    Text("Source prototype only. Not for health or heat-injury assessment.")
                        .font(.footnote)
                    Text(central.bluetoothReady ? "Bluetooth ready" : "Bluetooth unavailable")
                    HStack {
                        Button("Scan HR devices") { central.start() }
                        Spacer()
                        Button("Stop") { central.stop() }
                    }
                }
                Section("Anonymous discovered devices") {
                    ForEach(central.statuses.keys.sorted(by: { $0.uuidString < $1.uuidString }), id: \.self) { id in
                        VStack(alignment: .leading) {
                            Text("BLE device " + String(id.uuidString.prefix(8)))
                            Text(central.statuses[id] ?? "Unknown")
                                .font(.caption)
                            if let bpm = central.readings[id] {
                                Text(String(bpm) + " BPM")
                            } else {
                                Text("No current reading")
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("STEVE 1.0")
        }
    }
}
