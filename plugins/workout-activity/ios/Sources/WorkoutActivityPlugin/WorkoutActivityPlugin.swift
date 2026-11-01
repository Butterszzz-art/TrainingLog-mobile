import Foundation
import Capacitor
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts, updates and ends the workout Live Activity.
/// JS side: src/js/live-activity.js. Widget UI: native/ios/PocketCoachLiveActivity.
///
/// Needs NSSupportsLiveActivities in the app's Info.plist (codemagic.yaml
/// adds it) and iOS 16.2+; on older systems every call is a no-op.
@objc(WorkoutActivityPlugin)
public class WorkoutActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WorkoutActivityPlugin"
    public let jsName = "WorkoutActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise)
    ]

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.2, *) {
            call.resolve(["supported": ActivityAuthorizationInfo().areActivitiesEnabled])
        } else {
            call.resolve(["supported": false])
        }
    }

    /// Shows the given state, starting the Live Activity if none is running.
    /// Options mirror WorkoutActivityAttributes.ContentState; dates are epoch ms.
    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve(["active": false])
            return
        }
        guard let startedAtMs = call.getDouble("startedAt") else {
            call.reject("startedAt is required")
            return
        }
        let state = WorkoutActivityAttributes.ContentState(
            title: call.getString("title") ?? "Workout",
            startedAt: Date(timeIntervalSince1970: startedAtMs / 1000),
            exercise: call.getString("exercise"),
            setsDone: call.getInt("setsDone") ?? 0,
            exercisesDone: call.getInt("exercisesDone") ?? 0,
            restEndsAt: call.getDouble("restEndsAt").map { Date(timeIntervalSince1970: $0 / 1000) },
            restTotalSeconds: call.getInt("restTotalSeconds"),
            restPausedRemaining: call.getInt("restPausedRemaining")
        )
        // Marked stale when the rest runs out, so the widget can switch to
        // "Rest over" even while the app is suspended.
        let content = ActivityContent(state: state, staleDate: state.restRange?.upperBound)

        Task {
            let running = Activity<WorkoutActivityAttributes>.activities
            if let current = running.first {
                for extra in running.dropFirst() {
                    await extra.end(nil, dismissalPolicy: .immediate)
                }
                await current.update(content)
                call.resolve(["active": true])
                return
            }
            guard ActivityAuthorizationInfo().areActivitiesEnabled else {
                call.resolve(["active": false])
                return
            }
            do {
                _ = try Activity.request(attributes: WorkoutActivityAttributes(), content: content, pushType: nil)
                call.resolve(["active": true])
            } catch {
                call.reject("Could not start the Live Activity: \(error.localizedDescription)")
            }
        }
    }

    /// Ends every workout Live Activity and removes it from the Lock Screen.
    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.2, *) else {
            call.resolve()
            return
        }
        Task {
            for activity in Activity<WorkoutActivityAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            call.resolve()
        }
    }
}
