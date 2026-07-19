import ActivityKit
import WidgetKit
import SwiftUI

// MUST stay identical to the copy in the app module
// (modules/live-activity/ios/LiveActivityModule.swift). ActivityKit routes the
// app's `Activity.request` to this widget by the attributes type name + Codable
// shape; the two targets compile separate copies, so they must not drift.
struct RideLiveActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var statusLabel: String
    var pickup: String
    var dropoff: String
    var fare: String
    var phase: String
  }

  var rideId: String
  var title: String
}

// Brand accent — matches the app's ember/orange (#F2682C).
private let ember = Color(red: 0.949, green: 0.408, blue: 0.173)

// A colored dot per phase so the lock screen reads at a glance.
@available(iOS 16.2, *)
private func phaseColor(_ phase: String) -> Color {
  switch phase {
  case "accepted": return .blue
  case "arrived": return .orange
  case "in_progress": return .green
  default: return .gray
  }
}

// ─── Lock screen / banner presentation ──────────────────────────────────────
@available(iOS 16.2, *)
struct RideLockScreenView: View {
  let context: ActivityViewContext<RideLiveActivityAttributes>

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(context.attributes.title)
          .font(.headline)
          .lineLimit(1)
        Spacer()
        HStack(spacing: 6) {
          Circle()
            .fill(phaseColor(context.state.phase))
            .frame(width: 8, height: 8)
          Text(context.state.statusLabel)
            .font(.caption)
            .foregroundColor(.secondary)
            .lineLimit(1)
        }
      }

      HStack(alignment: .top, spacing: 8) {
        VStack(alignment: .leading, spacing: 4) {
          RideEndpointRow(color: .green, text: context.state.pickup)
          RideEndpointRow(color: ember, text: context.state.dropoff)
        }
        Spacer()
        VStack(alignment: .trailing, spacing: 2) {
          Text(context.state.fare)
            .font(.title3.bold())
          Text("Tarif")
            .font(.caption2)
            .foregroundColor(.secondary)
        }
      }
    }
    .padding()
    .activityBackgroundTint(Color.black.opacity(0.02))
  }
}

@available(iOS 16.2, *)
private struct RideEndpointRow: View {
  let color: Color
  let text: String
  var body: some View {
    HStack(spacing: 8) {
      Circle().fill(color).frame(width: 9, height: 9)
      Text(text).font(.subheadline).lineLimit(1)
    }
  }
}

// ─── Widget / Live Activity configuration ───────────────────────────────────
@available(iOS 16.2, *)
struct RideLiveActivityWidget: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: RideLiveActivityAttributes.self) { context in
      RideLockScreenView(context: context)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          HStack(spacing: 6) {
            Circle().fill(phaseColor(context.state.phase)).frame(width: 8, height: 8)
            Text(context.state.statusLabel).font(.caption).lineLimit(1)
          }
        }
        DynamicIslandExpandedRegion(.trailing) {
          Text(context.state.fare).font(.caption.bold())
        }
        DynamicIslandExpandedRegion(.bottom) {
          VStack(alignment: .leading, spacing: 4) {
            RideEndpointRow(color: .green, text: context.state.pickup)
            RideEndpointRow(color: ember, text: context.state.dropoff)
          }
        }
      } compactLeading: {
        Circle().fill(phaseColor(context.state.phase)).frame(width: 8, height: 8)
      } compactTrailing: {
        Text(context.state.fare).font(.caption2).lineLimit(1)
      } minimal: {
        Circle().fill(phaseColor(context.state.phase)).frame(width: 8, height: 8)
      }
      .keylineTint(ember)
    }
  }
}

// A live-activity-only widget bundle is the extension's entry point.
@main
struct RideActivityBundle: WidgetBundle {
  var body: some Widget {
    if #available(iOS 16.2, *) {
      RideLiveActivityWidget()
    }
  }
}
