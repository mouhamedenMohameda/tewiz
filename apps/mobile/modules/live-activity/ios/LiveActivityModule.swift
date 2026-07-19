import ExpoModulesCore
import ActivityKit

// Dynamic content pushed from JS (lib/liveActivity.ts). All pre-rendered
// strings — the widget is a dumb renderer, i18n/formatting stay in JS.
struct RideActivityStateRecord: Record {
  @Field var statusLabel: String = ""
  @Field var pickup: String = ""
  @Field var dropoff: String = ""
  @Field var fare: String = ""
  @Field var phase: String = ""
}

// The ActivityKit attributes for the ride Live Activity.
//
// IMPORTANT: this struct must stay byte-for-byte identical (same name, same
// Codable shape) to the copy in the widget extension
// (targets/rideactivity/index.swift). ActivityKit matches the app's `request`
// to the widget's rendering by the attributes type name + Codable structure;
// the two targets each compile their own copy, so they must not drift.
struct RideLiveActivityAttributes: ActivityAttributes {
  public struct ContentState: Codable, Hashable {
    var statusLabel: String
    var pickup: String
    var dropoff: String
    var fare: String
    var phase: String
  }

  // Static for the life of the activity.
  var rideId: String
  var title: String
}

public class LiveActivityModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LiveActivity")

    // Whether the OS + user allow Live Activities (iOS 16.2+ only).
    Function("areActivitiesEnabled") { () -> Bool in
      if #available(iOS 16.2, *) {
        return ActivityAuthorizationInfo().areActivitiesEnabled
      }
      return false
    }

    // Start a fresh activity for a ride. Returns the activity id, or nil when
    // unavailable/disabled/failed. Ends any existing ride activity first so we
    // never stack two.
    AsyncFunction("start") { (rideId: String, title: String, state: RideActivityStateRecord) -> String? in
      guard #available(iOS 16.2, *) else { return nil }
      guard ActivityAuthorizationInfo().areActivitiesEnabled else { return nil }

      for activity in Activity<RideLiveActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }

      let attributes = RideLiveActivityAttributes(rideId: rideId, title: title)
      let contentState = RideLiveActivityAttributes.ContentState(
        statusLabel: state.statusLabel,
        pickup: state.pickup,
        dropoff: state.dropoff,
        fare: state.fare,
        phase: state.phase
      )

      do {
        let activity = try Activity.request(
          attributes: attributes,
          content: ActivityContent(state: contentState, staleDate: nil)
        )
        return activity.id
      } catch {
        return nil
      }
    }

    // Update every live ride activity in place.
    AsyncFunction("update") { (state: RideActivityStateRecord) in
      guard #available(iOS 16.2, *) else { return }
      let contentState = RideLiveActivityAttributes.ContentState(
        statusLabel: state.statusLabel,
        pickup: state.pickup,
        dropoff: state.dropoff,
        fare: state.fare,
        phase: state.phase
      )
      for activity in Activity<RideLiveActivityAttributes>.activities {
        await activity.update(ActivityContent(state: contentState, staleDate: nil))
      }
    }

    // End every live ride activity immediately (ride completed/cancelled).
    AsyncFunction("end") {
      guard #available(iOS 16.2, *) else { return }
      for activity in Activity<RideLiveActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
    }
  }
}
